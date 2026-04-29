#!/usr/bin/env python3
"""Run mineru-open-mcp with image paths exposed in parse_documents results.

The upstream mineru-open-mcp package parses MinerU result zips into SDK
ExtractResult objects with `images`, but its MCP result builder only writes
Markdown and strips `zip_url` before returning. This launcher keeps the upstream
server and patches that narrow MCP boundary so callers can use extracted figures.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from mineru_open_mcp import config
from mineru_open_mcp.tools import extract as extract_mod
from mineru_open_mcp.tools import tools as tools_mod


_ORIGINAL_EXTRACT_SOURCES = extract_mod.extract_sources
_SOURCE_QUEUE_BY_FILENAME: Dict[str, List[str]] = {}


def _source_filename(source: str) -> str:
    if source.startswith(("http://", "https://")):
        name = source.split("?")[0].split("/")[-1]
        return name or source
    return Path(source).name


def _pop_source_for_filename(filename: str) -> Optional[str]:
    queue = _SOURCE_QUEUE_BY_FILENAME.get(filename) or []
    if not queue:
        return None
    source = queue.pop(0)
    if not queue:
        _SOURCE_QUEUE_BY_FILENAME.pop(filename, None)
    return source


def _is_local_image(source: str) -> bool:
    return Path(source).suffix.lower() in {".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp"}


def _copy_input_image(source: str, out_dir: Path, stem: str) -> Dict[str, Any]:
    image_dir = out_dir / stem / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    image_path = image_dir / Path(source).name
    shutil.copy2(source, image_path)
    return {
        "image_count": 1,
        "image_dir": str(image_dir),
        "image_paths": [str(image_path)],
        "image_source": "input_image",
    }


def _render_pdf_pages(source: str, out_dir: Path, stem: str) -> Dict[str, Any]:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("MinerU Flash mode returned Markdown only and pdftoppm is not available for local PDF page-image fallback. Set MINERU_API_TOKEN for extracted figures/images.")

    image_dir = out_dir / stem / "page-images"
    image_dir.mkdir(parents=True, exist_ok=True)
    prefix = image_dir / "page"
    completed = subprocess.run(
        [pdftoppm, "-png", "-r", "160", source, str(prefix)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=180,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"pdftoppm exited with code {completed.returncode}")

    image_paths = sorted(str(path) for path in image_dir.glob("page-*.png"))
    if not image_paths:
        raise RuntimeError("pdftoppm completed but produced no page images")
    return {
        "image_count": len(image_paths),
        "image_dir": str(image_dir),
        "image_paths": image_paths,
        "image_source": "pdf_page_render_fallback",
    }


def _fallback_images_from_source(source: Optional[str], out_dir: Path, stem: str) -> Dict[str, Any]:
    if not source or source.startswith(("http://", "https://")):
        return {}
    source_path = Path(source)
    if not source_path.exists():
        return {}
    if _is_local_image(source):
        return _copy_input_image(source, out_dir, stem)
    if source_path.suffix.lower() == ".pdf":
        return _render_pdf_pages(source, out_dir, stem)
    return {}


async def _extract_sources_with_source_tracking(*args: Any, **kwargs: Any) -> List[Dict[str, Any]]:
    sources = list(kwargs.get("sources") or (args[0] if args else []) or [])
    previous = {key: value[:] for key, value in _SOURCE_QUEUE_BY_FILENAME.items()}
    try:
        for source in sources:
            _SOURCE_QUEUE_BY_FILENAME.setdefault(_source_filename(str(source)), []).append(str(source))
        return await _ORIGINAL_EXTRACT_SOURCES(*args, **kwargs)
    finally:
        _SOURCE_QUEUE_BY_FILENAME.clear()
        _SOURCE_QUEUE_BY_FILENAME.update(previous)


async def _build_result_entry_with_images(
    result: Any,
    filename: str,
    stem: str,
    out_dir: Path,
    ctx: Any,
    save_to_file: bool = True,
) -> Dict[str, Any]:
    """Convert one SDK ExtractResult into an MCP response entry.

    This mirrors upstream behavior, then adds durable image artifacts:
    - image files are saved under `<output_dir>/<stem>/images/`
    - returned entry includes `image_paths`, `image_dir`, and `image_count`
    - `zip_url` is retained so clients can fetch the complete MinerU bundle
    """
    if result.state == "failed":
        if ctx and ctx.request_context:
            await ctx.warning(f"Parse failed: {filename} - {result.error}")
        return {
            "filename": filename,
            "status": "error",
            "error": result.error or "Server-side parse failed",
        }

    if result.markdown is None:
        return {
            "filename": filename,
            "status": "error",
            "error": "Parse succeeded but no Markdown was returned",
        }

    entry: Dict[str, Any] = {
        "filename": filename,
        "status": "success",
        "content": result.markdown,
    }

    out_dir.mkdir(parents=True, exist_ok=True)

    # Upstream only saves Markdown when parsing multiple sources. PPT Composer
    # needs durable parse artifacts even for the common single-PDF case, so save
    # whenever an output directory is available while still keeping inline
    # content in the MCP response.
    md_path = out_dir / f"{stem}.md"
    try:
        md_path.write_text(result.markdown, encoding="utf-8")
        extract_path = str(md_path)
    except Exception as exc:
        config.logger.warning("Failed to save Markdown for %s: %s", filename, exc)
        extract_path = str(out_dir)
    entry["extract_path"] = extract_path
    if ctx and ctx.request_context:
        await ctx.info(f"Saved: {filename} -> {extract_path}")

    source = _pop_source_for_filename(filename)
    image_error: Optional[str] = None
    try:
        images = list(getattr(result, "images", []) or [])
    except Exception as exc:
        # Some environments can parse Markdown successfully but fail while
        # downloading the optional MinerU result zip/images (for example proxy
        # or SSL EOF issues). Keep the document parse successful and surface the
        # image extraction problem as a warning field instead of failing intake.
        config.logger.warning("Failed to load extracted images for %s: %s", filename, exc)
        image_error = str(exc)
        images = []

    if images:
        image_dir = out_dir / stem / "images"
        image_dir.mkdir(parents=True, exist_ok=True)
        image_paths: List[str] = []
        for index, image in enumerate(images, 1):
            image_name = getattr(image, "name", "") or f"image_{index}.png"
            safe_name = Path(image_name).name
            image_path = image_dir / safe_name
            try:
                image.save(str(image_path))
                image_paths.append(str(image_path))
            except Exception as exc:
                config.logger.warning("Failed to save image %s for %s: %s", image_name, filename, exc)
        entry["image_count"] = len(image_paths)
        entry["image_dir"] = str(image_dir)
        entry["image_paths"] = image_paths
        entry["image_source"] = "mineru_extracted"
    else:
        try:
            fallback = _fallback_images_from_source(source, out_dir, stem)
        except Exception as exc:
            config.logger.warning("Failed to create fallback images for %s: %s", filename, exc)
            fallback = {}
            image_error = image_error or str(exc)
        if fallback:
            entry.update(fallback)
        else:
            entry["image_count"] = 0
            entry["image_paths"] = []
            if image_error:
                entry["image_error"] = image_error
            elif "<!-- image" in result.markdown:
                entry["image_error"] = (
                    "MinerU returned image placeholders but no extracted image files. "
                    "Set MINERU_API_TOKEN for full MinerU image extraction, or install pdftoppm for local PDF page-image fallback."
                )

    try:
        zip_url = result.zip_url
    except Exception as exc:
        config.logger.warning("Failed to read zip_url for %s: %s", filename, exc)
        zip_url = None
    if zip_url:
        entry["zip_url"] = zip_url

    if config.logger.isEnabledFor(10):
        task_id = getattr(result, "task_id", None)
        if task_id:
            entry["task_id"] = task_id

    return entry


def _format_results_keep_zip_url(
    results: List[Dict[str, Any]],
    output_dir: str = "",
    include_content: bool = True,
) -> Dict[str, Any]:
    """Upstream formatter without deleting `zip_url`."""
    if include_content:
        results = tools_mod._apply_content_limits(results, output_dir=output_dir)
    else:
        results = [{k: v for k, v in r.items() if k != "content"} for r in results]

    success_count = sum(1 for r in results if r.get("status") == "success")
    error_count = len(results) - success_count
    saved_paths = [
        (r.get("filename", ""), r["extract_path"])
        for r in results
        if r.get("status") == "success" and r.get("extract_path")
    ]

    response: Dict[str, Any] = {
        "status": "error" if success_count == 0 else "partial_success" if error_count > 0 else "success",
        "results": results,
        "summary": {
            "total_files": len(results),
            "success_count": success_count,
            "error_count": error_count,
        },
    }
    if success_count > 0:
        response["message"] = tools_mod._brand_message(saved_paths=saved_paths or None)
    return response


def _install_patches() -> None:
    extract_mod.extract_sources = _extract_sources_with_source_tracking
    tools_mod.extract_sources = _extract_sources_with_source_tracking
    extract_mod._build_result_entry = _build_result_entry_with_images
    tools_mod._format_results = _format_results_keep_zip_url


def main() -> None:
    parser = argparse.ArgumentParser(description="MinerU MCP server with image path exposure")
    parser.add_argument("--output-dir", "-o", type=str)
    parser.add_argument("--transport", "-t", type=str, default="stdio")
    parser.add_argument("--port", "-p", type=int, default=8001)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    args = parser.parse_args()

    _install_patches()

    from mineru_open_mcp import server

    if args.transport == "stdio" and (args.host != "0.0.0.0" or args.port != 8001):
        print("Warning: --host and --port are ignored in stdio mode.", file=sys.stderr)

    if not config.MINERU_API_TOKEN:
        print(
            "Warning: MINERU_API_TOKEN is not set; Flash mode will be used "
            "(free, 20 pages / 10 MB per file).",
            file=sys.stderr,
        )

    if args.output_dir:
        server.set_output_dir(args.output_dir)

    server.run_server(mode=args.transport, port=args.port, host=args.host)


if __name__ == "__main__":
    main()
