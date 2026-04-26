#!/usr/bin/env python3
"""Run mineru-open-mcp with image paths exposed in parse_documents results.

The upstream mineru-open-mcp package parses MinerU result zips into SDK
ExtractResult objects with `images`, but its MCP result builder only writes
Markdown and strips `zip_url` before returning. This launcher keeps the upstream
server and patches that narrow MCP boundary so callers can use extracted figures.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from mineru_open_mcp import config
from mineru_open_mcp.tools import extract as extract_mod
from mineru_open_mcp.tools import tools as tools_mod


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

    if save_to_file:
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

    images = list(getattr(result, "images", []) or [])
    if images:
        image_dir = out_dir / stem / "images"
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

    if result.zip_url:
        entry["zip_url"] = result.zip_url

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
