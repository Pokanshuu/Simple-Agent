"""Generate the source icon for Simple Agent (1024x1024 PNG).

Motif: a rounded speech bubble with a terminal caret inside — chat app + agent.
Rendered at 4x and downsampled for clean edges.
"""

from PIL import Image, ImageDraw, ImageFilter

S = 4
size = 1024 * S

img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# Vertical gradient backdrop on a rounded square.
top = (86, 106, 255)
bottom = (26, 32, 86)
radius = int(size * 0.235)

grad = Image.new("RGB", (1, size))
for y in range(size):
    grad.putpixel((0, y), lerp(top, bottom, y / size))
grad = grad.resize((size, size))

mask = Image.new("L", (size, size), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# Speech bubble body.
bx0, by0, bx1, by1 = int(size * 0.17), int(size * 0.22), int(size * 0.83), int(size * 0.66)
bubble_r = int(size * 0.10)
draw.rounded_rectangle([bx0, by0, bx1, by1], radius=bubble_r, fill=(255, 255, 255, 236))

# Bubble tail (triangle) hanging under the left third.
tail = [
    (int(size * 0.31), by1 - int(size * 0.02)),
    (int(size * 0.31), by1 + int(size * 0.13)),
    (int(size * 0.47), by1 - int(size * 0.02)),
]
draw.polygon(tail, fill=(255, 255, 255, 236))

# Terminal caret ">" on the left.
stroke = int(size * 0.026)
cx, cy = int(size * 0.36), int(size * 0.44)
draw.line([(cx - int(size * 0.075), cy - int(size * 0.075)),
           (cx + int(size * 0.02), cy),
           (cx - int(size * 0.075), cy + int(size * 0.075))],
          fill=(48, 58, 140, 255), width=stroke, joint="curve")

# Underscore cursor on the right.
draw.rounded_rectangle(
    [int(size * 0.50), int(size * 0.505), int(size * 0.66), int(size * 0.505) + stroke],
    radius=stroke // 2,
    fill=(48, 58, 140, 255),
)

# Three "thinking" dots under the bubble — the agent working.
for i, x in enumerate((0.38, 0.5, 0.62)):
    r = int(size * 0.021)
    cy2 = int(size * 0.815)
    alpha = 235 - i * 40
    draw.ellipse([int(size * x) - r, cy2 - r, int(size * x) + r, cy2 + r],
                 fill=(255, 255, 255, alpha))

# Soft inner highlight along the top edge.
glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius,
                     outline=(255, 255, 255, 60), width=int(size * 0.012))
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(int(size * 0.006))))

img = img.resize((1024, 1024), Image.LANCZOS)
img.save(r"D:\Codes\Simple-Agent\src-tauri\app-icon.png")
print("wrote app-icon.png", img.size)
