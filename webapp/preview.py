"""Render limited, flattened previews without sharing the original file."""
import base64
import io
import math

PREVIEW_TYPES = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}


def render_preview(raw, extension, viewer):
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    pages = []

    def add(image, label, limit):
        image = image.convert("RGBA")
        image.thumbnail((limit, limit))
        background = Image.new("RGBA", image.size, "white")
        background.alpha_composite(image)
        font = ImageFont.load_default(size=16)
        mark = f"PREVIEW ONLY  /  @{viewer}"
        tile = Image.new("RGBA", (350, 56))
        draw = ImageDraw.Draw(tile)
        draw.text((10, 22), mark, font=font, fill=(0, 0, 0, 165),
                  stroke_width=1, stroke_fill=(255, 255, 255, 190))
        for y in range(0, image.height, tile.height):
            for x in range(-((y // tile.height) % 2) * 160, image.width, tile.width):
                background.alpha_composite(tile, (x, y))
        # A visible stamp even for very small or unusually shaped images.
        canvas = Image.new("RGB", (max(image.width, 350), image.height + 32), "#172334")
        canvas.paste(background.convert("RGB"), ((canvas.width - image.width) // 2, 0))
        ImageDraw.Draw(canvas).text((10, image.height + 7), mark, font=font, fill="white")
        out = io.BytesIO()
        canvas.save(out, "JPEG", quality=65)
        pages.append({"label": label, "src": "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode("ascii")})

    if extension == ".pdf":
        from pypdfium2 import PdfDocument

        document = PdfDocument(raw)
        try:
            count = len(document)
            if not 1 <= count <= 2000:
                raise ValueError("PDF page count out of range")
            limit = 420 if count <= 2 else 760
            for index in sorted({0, count - 1}):
                page = document[index]
                try:
                    width, height = page.get_size()
                    if not all(math.isfinite(n) and 0 < n <= 14400 for n in (width, height)):
                        raise ValueError("Invalid PDF dimensions")
                    bitmap = page.render(scale=min(1.5, limit / max(width, height)), draw_annots=False)
                    try:
                        add(bitmap.to_pil(), f"Page {index + 1} of {count}", limit)
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        finally:
            document.close()
    else:
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as image:
            if image.width * image.height > 16_000_000:
                raise ValueError("Image is too large to preview")
            add(ImageOps.exif_transpose(image), "Reduced image preview", 420)
    return {"pages": pages}
