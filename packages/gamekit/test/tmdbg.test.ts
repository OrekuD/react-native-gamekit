import { describe, it } from 'node:test';
describe('tmdbg', () => {
  it('repro', async () => {
    const { defineTileMap2D, defineTileSet2D } = await import('../src/tilemap/definitions.ts');
    const { movePlatformerBody2D } = await import('../src/tilemap/movement.ts');
    const tileset = defineTileSet2D({ tiles: { ground: { frame: 'g', collision: 'solid' }, oneway: { frame: 'o', collision: 'one-way-up' } } });
    const m = defineTileMap2D({
      cellSize: { width: 16, height: 16 }, tileset,
      layers: [{ id: 't', width: 8, height: 4, data: [
        0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,
        2,2,2,2,2,2,2,2,
        1,1,1,1,1,1,1,1,
      ] }],
    });
    try {
      movePlatformerBody2D({
        body: { x: 0, y: -28, width: 12, height: 12 },
        velocity: { x: 0, y: 100 }, deltaSeconds: 1,
        map: m, collisionLayers: ['t'],
      });
      console.error('NO-THROW');
    } catch (e) {
      console.error('ERR:', (e as Error).message);
    }
  });
});
