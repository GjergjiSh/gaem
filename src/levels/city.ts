// Natural sizes of the city pack in /assets/city, measured from each glTF's
// POSITION accessors -- regenerate with tools/measure-city.py.
//
// A THIRD kit, and the only one of the three that is a building kit. The sci-fi
// pack is infrastructure -- catwalks, plant, service doors -- and the Platforms
// kit is untextured, so neither has ever had anything to say about the part of
// a building a person stands next to. This one is nothing but that: brick and
// concrete wall modules, shopfronts, cornices, corner columns, entrances with
// their own steps, sidewalks with a real curb on them, doors, bollards,
// planters, manhole covers, and a full set of road markings.
//
// It is authored in METRES on a clean modular grid, and the grid is worth
// knowing before placing anything:
//
//   a wall panel   2 m wide, 3 m tall, 0.2 m thick
//   an inset       4 m wide -- the same storey, half the pieces
//   a storey       3 m
//   a corner       2 x 2
//   a sidewalk     3 m slabs, 0.15 m of curb
//
// Panels carry their thickness on Z, so one faces its own +Z and turning it to
// face out of a wall is a yaw and nothing else. That is the same convention as
// a door in the sci-fi kit and the OPPOSITE of that kit's `_Straight` wall
// pieces, which are thin on X -- the one thing most likely to put a facade on
// this map edge-on to the street it is meant to face.
//
// What it costs is the other thing to know. A window module is five primitives
// -- brick, trim, glass, a fake interior and an interior wall -- so it is five
// draw calls, where a plain panel is two and a bollard, a manhole, a cornice or
// a road marking is one. That is why the shopfronts go where the player stops
// and looks, and the cheap pieces go everywhere.

/** Natural bounding box of each model, [width, height, depth], in metres. */
export const CITY: Record<string, readonly [number, number, number]> = {
  Brick_90Angle_L: [0.7062, 3.0, 0.7],
  Brick_90Angle_R: [0.7062, 3.0, 0.7],
  Brick_BottomTrim: [2.0, 3.0, 0.229],
  Brick_Column_RedBricks: [0.5258, 3.0021, 0.7202],
  Brick_Column_Small: [0.25, 3.0, 0.35],
  Brick_Column_TrimBricks: [0.6514, 3.0008, 0.636],
  Brick_CornerColumn_Bottom: [1.26, 3.0, 1.26],
  Brick_CornerColumn_Cap: [1.26, 1.0123, 1.26],
  Brick_CornerColumn_CapShort: [1.26, 0.2411, 1.26],
  Brick_CornerColumn_Center: [1.14, 3.0, 1.14],
  Brick_CornerColumn_Center_Half: [1.14, 1.9995, 1.14],
  Brick_CornerColumn_Top: [1.26, 3.0, 1.26],
  Brick_Corner_Plain: [2.0, 3.0, 2.0],
  Brick_HalfColumn_Bottom: [1.1088, 3.0, 0.2763],
  Brick_HalfColumn_Center: [0.9323, 3.0004, 0.2132],
  Brick_HalfColumn_Top: [1.1088, 3.0, 0.2763],
  Brick_HalfTrim: [2.0, 3.0, 0.2247],
  Brick_Inset: [4.0, 3.0, 0.2],
  Brick_Inset_Window: [4.0, 3.0, 0.3743],
  Brick_Inset_Window_Curved: [4.0, 3.0, 0.3737],
  Brick_Inset_Window_Curved_Small: [4.0, 3.0, 0.3426],
  Brick_InteriorWall_1: [2.0, 1.0, 0.0],
  Brick_InteriorWall_3: [2.0, 3.0, 0.0],
  Brick_InteriorWall_4: [2.0, 4.0, 0.0],
  Brick_Ornament_Horizontal: [2.0, 0.314, 0.0514],
  Brick_Plain_1: [2, 1.0, 0.2],
  Brick_Plain_3: [2, 3.0, 0.2],
  Brick_Plain_3_noWear: [2, 3.0, 0.2],
  Brick_Plain_4: [2.0, 4.0, 0.2],
  Brick_RedWhite_DoubleWindow: [4.0, 3.0, 0.2773],
  Brick_TopTrim: [2, 3.0, 0.2],
  Brick_TopTrim_90Angle_L: [0.7062, 3.0, 0.7],
  Brick_TopTrim_90Angle_R: [0.7062, 3.0, 0.7],
  Brick_TopTrim_Corner: [2.0, 3.0, 2.0],
  Brick_Window_CurvedDouble: [4.0, 3.0, 0.2605],
  Brick_Window_Square_Single: [2, 3.0, 0.271],
  Brick_Window_Trim: [2.0, 3.0, 0.304],
  Brick_Window_Trim_Single: [2.0, 3.0, 0.2769],
  Building_Large_2: [20.6441, 28.0, 16.6446],
  Building_Medium_2_001: [15.0557, 25.0087, 13.0557],
  Building_Small_1: [12.46, 17.026, 14.536],
  Cornice_Brick_90Angle_L: [2.0, 1.0, 0.9],
  Cornice_Brick_90Angle_R: [2.0, 1.0, 0.9],
  Cornice_Brick_Center: [2.0, 1.0, 0.4],
  Cornice_Brick_L: [2.0, 1.0, 0.4],
  Cornice_Brick_R: [2.0, 1.0, 0.4],
  Cornice_Metal_90Angle_L: [2.0, 1.0, 0.7],
  Cornice_Metal_90Angle_R: [2.0, 1.0, 0.7],
  Cornice_Metal_Center: [2.0, 1.0, 0.2],
  Cornice_Metal_L: [2.1, 1.0, 0.2],
  Cornice_Metal_R: [2.1, 1.0, 0.2],
  Cornice_Trim_90Angle_L: [2.0, 0.9984, 1.1278],
  Cornice_Trim_90Angle_R: [2.0, 0.9984, 1.1278],
  Cornice_Trim_Center: [2.0, 0.9984, 0.6278],
  Cornice_Trim_L: [2.5278, 0.9984, 0.6278],
  Cornice_Trim_R: [2.5278, 0.9984, 0.6278],
  Decal_ArrowForwardLeft: [1.7759, 0.0, 2.6746],
  Decal_ArrowForwardRight: [1.7759, 0.0, 2.6746],
  Decal_ArrowStraight: [0.9429, 0.0, 2.3697],
  Decal_ArrowTurnLeft: [1.9878, 0.0, 2.5025],
  Decal_ArrowTurnRight: [1.9878, 0.0, 2.5025],
  Decal_Bikelane: [2.9654, 0.0, 2.8162],
  Decal_BrokenLine_Straight: [6.0, 0.0, 0.2],
  Decal_Crosswalk: [4.5382, 0.0, 5.426],
  Decal_Crosswalk_Wide: [4.6663, 0.0, 11.4158],
  Decal_Curve_2Lane_Stripe: [8.8, 0.0, 8.8],
  Decal_Curve_4LaneShort: [9.1, 0.0, 9.1],
  Decal_Curve_4LaneShort_DoubleYellow: [9.1969, 0.0, 9.1969],
  Decal_Curve_4LaneShort_Stripe: [14.8, 0.0, 14.8],
  Decal_DoubleYellow_Straight: [6.0, 0.0, 0.3939],
  Decal_Only: [2.8998, 0.0, 1.3819],
  Decal_Slow: [2.9388, 0.0, 1.405],
  Decal_Stop: [2.9594, 0.0, 1.522],
  DoorFrame_Metal_Single: [2.0, 3.0, 0.2],
  DoorFrame_Trim: [2.0, 3.0, 0.2256],
  DoorFrame_Wooden: [2.304, 3.0, 0.4778],
  Door_1: [1.0, 2.2, 0.2599],
  Door_2: [1.0, 2.2, 0.2103],
  Door_3: [1.0, 2.2, 0.1883],
  Entrance_Concrete_2x1: [2.0, 1.0067, 1.0032],
  Entrance_Concrete_2x2: [2.0, 1.0067, 2.0033],
  Floor_2x2: [2, 0.1, 2],
  Floor_4x4: [4, 0.1, 4],
  Floor_Inset: [2, 0.1, 1.3333],
  Metal_Column_Bottom: [0.569, 3.0, 0.5694],
  Metal_Column_Center: [0.4978, 3.0, 0.4982],
  Metal_Column_Small_Bottom: [0.2845, 3.0, 0.2847],
  Metal_Column_Small_Center: [0.2489, 3.0, 0.2491],
  Metal_Column_Small_Top: [0.3221, 2.9956, 0.3223],
  Metal_Column_Top: [0.6441, 2.9956, 0.6446],
  Metal_FirstFloor_Wall: [2.0, 3.0, 0.242],
  Metal_FirstFloor_Wall_1: [2.0, 1.0, 0.242],
  Metal_FirstFloor_Window: [2.0, 3.0, 0.2588],
  Metal_FullWindow: [2.0, 3.0, 0.2311],
  Metal_Plain_1: [2.0, 1.0, 0.2],
  Metal_Plain_3: [2.0, 3.0, 0.2],
  Metal_Window: [4.0, 3.0006, 0.2239],
  Metal_Window_Half: [2.0, 3.0, 0.2286],
  Prop_ACUnit: [0.8932, 0.6, 0.3471],
  Prop_Bollard: [0.2163, 0.8918, 0.2274],
  Prop_Drain: [0.5852, 0.0404, 0.5852],
  Prop_ManholeCover: [0.9251, 0.033, 0.9251],
  Prop_Planter_Single: [2, 0.6, 2],
  Roof_2x2: [2.0, 0.0, 2.0],
  Roof_2x2_90Angle_Center: [2.0, 0.0, 1.6],
  Roof_2x2_90Angle_L: [2.0, 0.0, 2.0],
  Roof_2x2_90Angle_R: [2.0, 0.0, 2.0],
  Roof_4x4: [4.0, 0.0, 4.0],
  Roof_SlateCornice_Center: [2, 3.2, 2],
  Roof_SlateCornice_Corner: [2.0232, 3.2142, 2.0347],
  Roof_SlateCornice_InnerCorner: [2.0, 3.2, 2.0],
  Roof_SlateCornice_Window_1: [2, 3.2, 2.1187],
  Roof_Slate_Center: [2, 3, 2],
  Roof_Slate_Corner: [2.0232, 3.0281, 2.0347],
  Roof_Slate_InnerCorner: [2.0, 3.0, 2.0],
  Roof_Slate_Window_1: [2, 3, 2.1187],
  Sidewalk_Corner_Flat_3m: [3.01, 0.15, 3.01],
  Sidewalk_Corner_Flat_3m_Stripe: [3.4002, 0.0, 3.4002],
  Sidewalk_Corner_Round_3m: [3.01, 0.15, 3.01],
  Sidewalk_Corner_Round_3m_Stripe: [3.4, 0.0, 3.4],
  Sidewalk_NoCurb_3m: [3.0, 0.15, 3.0],
  Sidewalk_Planter: [1.9731, 0.5057, 1.7654],
  Sidewalk_Straight_3m: [3.0, 0.15, 3.01],
  Sidewalk_Straight_3m_Stripe: [3.0, 0.0, 0.2],
  Stairs_Entrance_Concrete: [2.0, 1.0067, 1.9908],
  Stairs_Rails_Metal: [1.964, 1.9814, 2.306],
  Stairs_Rails_Metal_Straight_1: [1.9389, 0.9981, 1.0],
  Stairs_Rails_Metal_Straight_2: [1.9389, 0.9981, 2.0],
  Street_2Lane: [6.0, 0.15, 12.0],
  Street_2Lane_noSidewalk: [6.0, 0.002, 6.0],
  Street_4Lane: [6.0, 0.15, 18.0],
  Street_4Lane_noSidewalk: [6.0, 0.002, 12.0],
  Street_4WayIntersection: [24.6663, 0.15, 24.6663],
  Street_Asphalt_6x6: [6.0, 0.0, 6.0],
  Street_Asphalt_9x9: [9.0, 0.0, 9.0],
  Street_Asphalt_Curve_2Lane: [10.0, 0.0, 10.0],
  Street_Asphalt_Curve_4Lane_Short: [16.0, 0.0, 16.0],
  Street_Curve_2Lane: [12.0, 0.15, 12.0],
  Street_Curve_2Lane_Curb: [12.0, 0.15, 12.0],
  Street_Curve_4LaneShort: [18.0, 0.15, 18.0],
  Street_Curve_4Lane_Short_Curb: [18.0, 0.15, 18.0],
  Street_TIntersection: [24.6663, 0.15, 21.3331],
  Trim_90Angle_TopCover: [2.0, 0.02, 0.7],
  Trim_Column_Bottom: [0.7242, 3.0, 0.7242],
  Trim_Column_Center: [0.6716, 3.0, 0.6716],
  Trim_Column_Top: [0.7242, 3.0, 0.7242],
  Trim_Corner: [2.0478, 3.0, 2.0478],
  Trim_FirstFloor_Wall: [2.0, 3.0, 0.2478],
  Trim_FirstFloor_Window_001: [2.0, 3.0103, 0.2151],
  Trim_FirstFloor_Window_Columns: [2.1469, 2.3373, 0.0921],
  Trim_Plain_3: [2.0, 3.0, 0.2],
  Trim_Wall_Guard: [2.0, 0.6442, 0.1185],
  Trim_Window: [2.0, 3.0, 0.2397],
};

/** World-space size of a city prop at a uniform scale. */
export function cityBox(name: string, scale = 1): [number, number, number] {
  const n = CITY[name];
  if (!n) throw new Error(`unknown city model: ${name}`);
  return [n[0] * scale, n[1] * scale, n[2] * scale];
}

/**
 * The same box with any ZERO axis opened up to something a brush can be. Road
 * markings and roof plates are modelled as planes; everything else is solid.
 * Only zero is touched -- see the note on `sciBrush`, which learned this the
 * expensive way.
 */
export function cityBrush(name: string, scale = 1): [number, number, number] {
  const s = cityBox(name, scale);
  const F = 1e-3;
  const MIN = 0.08;
  return [s[0] > F ? s[0] : MIN, s[1] > F ? s[1] : MIN, s[2] > F ? s[2] : MIN];
}
