"""Measure every kit model's natural bounding box straight out of the glTF.

The accessors carry POSITION min/max, so this needs no mesh data at all -- just
the node transforms composed down the scene graph.
"""
import json, io, glob, os


def compose(n):
    if 'matrix' in n:
        m = n['matrix']
        return [[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]]
    t = n.get('translation', [0, 0, 0])
    r = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    M = [[R[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)]
    M.append([0, 0, 0, 1])
    return M


def mul(A, B):
    return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def xf(M, p):
    return [sum(M[i][j] * p[j] for j in range(3)) + M[i][3] for i in range(3)]


def measure(path):
    d = json.load(io.open(path, encoding='utf-8'))
    lo, hi = [1e9] * 3, [-1e9] * 3

    def walk(idx, P):
        n = d['nodes'][idx]
        M = mul(P, compose(n))
        if 'mesh' in n:
            for pr in d['meshes'][n['mesh']]['primitives']:
                a = d['accessors'][pr['attributes']['POSITION']]
                for cx in (a['min'][0], a['max'][0]):
                    for cy in (a['min'][1], a['max'][1]):
                        for cz in (a['min'][2], a['max'][2]):
                            w = xf(M, [cx, cy, cz])
                            for i in range(3):
                                lo[i] = min(lo[i], w[i])
                                hi[i] = max(hi[i], w[i])
        for c in n.get('children', []):
            walk(c, M)

    I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
    for r in d['scenes'][d.get('scene', 0)]['nodes']:
        walk(r, I)
    return [round(hi[i] - lo[i], 4) for i in range(3)]


SIZES = {os.path.basename(f)[:-5]: measure(f)
         for f in sorted(glob.glob('assets/Platforms/*.gltf'))}

if __name__ == '__main__':
    for k, v in SIZES.items():
        print(k, v)
