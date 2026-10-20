// Pin clustering for the consultants map, without an extra library: points closer than `radius` pixels at the current zoom
// form one cluster. Pure and deterministic (the result depends only on the points, their order and the zoom).

export type ClusterPoint = { id: string; lat: number; lng: number };
export type Cluster = { ids: string[]; lat: number; lng: number };

/** Web Mercator pixel position at a zoom level (256 px tiles). */
export function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * scale, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale };
}

/** Zoom from which every pin is shown alone. */
export const CLUSTER_MAX_ZOOM = 12;

export function clusterPoints(points: ClusterPoint[], zoom: number, radius = 44): Cluster[] {
  if (zoom >= CLUSTER_MAX_ZOOM) return points.map((p) => ({ ids: [p.id], lat: p.lat, lng: p.lng }));
  const groups: Array<{ ids: string[]; lat: number; lng: number; x: number; y: number }> = [];
  for (const p of points) {
    const at = project(p.lat, p.lng, zoom);
    const near = groups.find((g) => Math.hypot(g.x - at.x, g.y - at.y) <= radius);
    if (near) {
      const n = near.ids.length;
      near.ids.push(p.id);
      near.lat = (near.lat * n + p.lat) / (n + 1);
      near.lng = (near.lng * n + p.lng) / (n + 1);
      const c = project(near.lat, near.lng, zoom);
      near.x = c.x; near.y = c.y;
    } else {
      groups.push({ ids: [p.id], lat: p.lat, lng: p.lng, x: at.x, y: at.y });
    }
  }
  return groups.map(({ ids, lat, lng }) => ({ ids, lat, lng }));
}
