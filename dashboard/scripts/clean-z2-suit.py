"""Clean NASA's Z2 spacesuit GLB (NASA 3D Resources, free and without copyright) for the dashboard:
lift the grime on fabric, blank the NASA insignia patch, add a roughness map so the visor is glossy,
drop the specular layer and the JPEG fallbacks, and repack as a small GLB (Draco geometry kept)."""
import io, json, struct, sys
import numpy as np
from PIL import Image

src, out_glb, preview = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(src, 'rb').read()
clen = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + clen])
binc = b[20 + clen + 8:]
view = lambda i: binc[j['bufferViews'][i].get('byteOffset', 0): j['bufferViews'][i].get('byteOffset', 0) + j['bufferViews'][i]['byteLength']]
img = {im['name'] + ('.webp' if im['mimeType'] == 'image/webp' else '.jpg'): im['bufferView'] for im in j['images']}
color = np.asarray(Image.open(io.BytesIO(view(img['z2_Color_s.webp']))).convert('RGB'), dtype=np.float32) / 255
spec = np.asarray(Image.open(io.BytesIO(view(img['z2_spec_color_s.webp']))).convert('RGB'), dtype=np.float32) / 255

lum = lambda a: a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

L = lum(color)
S = lum(spec)
sat = color.max(-1) - color.min(-1)
matte = smooth(0.2, 0.08, S)                 # fabric, boots and gloves are matte in the spec map
warm = color[..., 0] - color[..., 2]
# Pure black parts (boots, belt, inner gloves, visor) stay black; grime is brown even when very dark.
fabricish = np.maximum(smooth(0.06, 0.13, L), smooth(0.04, 0.065, warm))
neutral = smooth(0.32, 0.18, sat)            # leave the red piping, blue bands and patches alone
k = (matte * fabricish * neutral)[..., None]

dirt = smooth(0.75, 0.15, L) * smooth(0.035, 0.06, warm)
lifted = 1 - (1 - color) * (0.36 * (1 - 0.65 * dirt))[..., None]   # grime fades; seams stay faintly visible
lifted_l = lum(lifted)[..., None]
cleaned = lifted * 0.45 + lifted_l * 0.55    # mostly neutral white
cleaned = cleaned * np.array([0.985, 0.988, 0.995], dtype=np.float32)
out = color + (cleaned - color) * k

# Blank the NASA insignia patch (bottom-left of the atlas): find its saturated blue core and paint a
# disc of clean fabric over it. Space Apps projects must not carry NASA's insignia.
H, W = L.shape
y0, y1, x0, x1 = int(H * 0.83), int(H * 0.90), int(W * 0.04), int(W * 0.10)
reg = color[y0:y1, x0:x1]
blue = (reg[..., 2] > 0.35) & (reg[..., 2] - reg[..., 0] > 0.18)
ys, xs = np.nonzero(blue)
if len(ys) > 50:
    cy, cx = int(ys.mean()) + y0, int(xs.mean()) + x0
    r = int(max(ys.max() - ys.min(), xs.max() - xs.min()) * 0.62) + 6
    yy, xx = np.ogrid[:H, :W]
    disc = (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r
    out[disc] = np.array([0.93, 0.935, 0.94], dtype=np.float32)
    insignia = disc
    print('blanked insignia at', cx, cy, 'radius', r)
else:
    insignia = None
    print('insignia not found', len(ys))

out8 = Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)).resize((2048, 2048), Image.LANCZOS)
cbuf = io.BytesIO(); out8.save(cbuf, 'WEBP', quality=88, method=6); cdata = cbuf.getvalue()
out8.resize((1024, 1024)).save(preview)

# Roughness / metalness (glTF: G = roughness, B = metalness): glossy visor, matte fabric.
glossy = smooth(0.25, 0.6, S) * (1 - neutral * 0.0)
rough = 0.82 - glossy * 0.74                 # fabric 0.82, visor 0.08
metal = glossy * 0.55
if insignia is not None:
    rough[insignia] = 0.82
    metal[insignia] = 0.0
mr = np.stack([np.ones_like(rough), rough, metal], -1)
mr8 = Image.fromarray(np.clip(mr * 255 + 0.5, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR)
mbuf = io.BytesIO(); mr8.save(mbuf, 'WEBP', quality=90, method=6); mdata = mbuf.getvalue()

# Repack: the Draco geometry view, then the two WebP images.
draco_view = j['meshes'][0]['primitives'][0]['extensions']['KHR_draco_mesh_compression']['bufferView']
chunks, views = [], []
def add(data):
    off = sum(len(c) for c in chunks)
    chunks.append(data + b'\0' * ((4 - len(data) % 4) % 4))
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    return len(views) - 1
dv = add(view(draco_view))
cv = add(cdata)
mv = add(mdata)
j['meshes'][0]['primitives'][0]['extensions']['KHR_draco_mesh_compression']['bufferView'] = dv
j['bufferViews'] = views
j['images'] = [{'name': 'z2_color_clean', 'mimeType': 'image/webp', 'bufferView': cv}, {'name': 'z2_roughness_metal', 'mimeType': 'image/webp', 'bufferView': mv}]
j['textures'] = [{'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': 0}}}, {'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': 1}}}]
m = j['materials'][0]
m.pop('extensions', None); m.pop('normalTexture', None)
m['pbrMetallicRoughness'] = {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}, 'metallicFactor': 1.0, 'roughnessFactor': 1.0}
j['extensionsUsed'] = ['KHR_draco_mesh_compression', 'EXT_texture_webp']
j['extensionsRequired'] = ['KHR_draco_mesh_compression', 'EXT_texture_webp']
j.setdefault('asset', {})['copyright'] = 'NASA 3D Resources (free and without copyright): Z2 Spacesuit. Cleaned for GRAVITYGUARD: grime lifted, insignia removed.'
bin_all = b''.join(chunks)
j['buffers'] = [{'byteLength': len(bin_all)}]
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(bin_all)
with open(out_glb, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, total))
    f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
    f.write(struct.pack('<I4s', len(bin_all), b'BIN\0')); f.write(bin_all)
print('wrote', out_glb, total, 'bytes; color', len(cdata), 'mr', len(mdata), 'draco', len(view(draco_view)))
