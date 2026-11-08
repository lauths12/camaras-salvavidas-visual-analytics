import math

LAT0 = 4.65
LON0 = -74.1
M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))


def to_xy(lon, lat):
    return ((lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT)


def point_segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def point_to_multilinestring_distance(lon, lat, coordinates):
    px, py = to_xy(lon, lat)
    best = math.inf
    for line in coordinates:
        pts = [to_xy(c[0], c[1]) for c in line]
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            d = point_segment_distance(px, py, ax, ay, bx, by)
            if d < best:
                best = d
    return best
