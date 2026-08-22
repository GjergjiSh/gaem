// Natural sizes of the sci-fi pack -- /assets/scifi for the environment and
// /assets/more-scifi for the props -- measured from each glTF's POSITION
// accessors. Regenerate with tools/measure-scifi.py.
//
// The two folders are one kit: the prop set is textured off the same trim
// sheets as the environment set, byte for byte, which is the test that matters.
// Two packs that merely look similar are two styles.
//
// Unlike the older Platforms kit this one is authored IN METRES: a crate is
// 1.0 tall, a barrel 1.1, a handrail 0.86, a wall panel 4 wide by 3 high. So
// there is no scale factor here and there should not be one -- the numbers are
// already the numbers, and a prop built at its measured size comes out at human
// scale beside a 1.8 m character.
//
// The pack is modular on a 4 m grid. Every `_Straight` wall panel is 4 m along
// its length with the thickness on X, so a panel's long axis is Z and turning
// one to face a wall is the same quarter-turn every time.

/** Natural bounding box of each model, [width, height, depth], in metres. */
export const SCIFI: Record<string, readonly [number, number, number]> = {
  BottomMetal_Corner_Round_Inner: [4.0, 0.02, 4.0],
  BottomMetal_Corner_Round_Outer: [4.6, 0.02, 4.6],
  BottomMetal_Corner_Square_Inner: [4.0, 0.02, 4.0],
  BottomMetal_Corner_Square_Outer_1: [0.6, 0.02, 0.6],
  BottomMetal_Corner_Square_Outer_2: [0.6, 0.02, 0.6],
  BottomMetal_Straight: [0.6, 0.02, 4.0],
  BottomSimple_Corner_Round_Inner: [4.0, 0.02, 4.0],
  BottomSimple_Corner_Round_Outer: [4.6, 0.02, 4.6],
  BottomSimple_Corner_Square_Inner: [4.0, 0.02, 4.0],
  BottomSimple_Corner_Square_Outer_1: [0.6, 0.02, 0.6],
  BottomSimple_Corner_Square_Outer_2: [0.6, 0.02, 0.6],
  BottomSimple_Straight: [0.6, 0.02, 4.0],
  ShortWall_AccentStrip_Corner_Inner: [4.0, 0.9981, 4.0],
  ShortWall_AccentStrip_Corner_Outer: [4.0, 0.9981, 4.0],
  ShortWall_AccentStrip_Straight: [0.0, 0.9981, 4.0],
  ShortWall_Band2_Corner_Inner: [4.0043, 1.9981, 4.0],
  ShortWall_Band2_Corner_Outer: [4.0, 1.9981, 4.0043],
  ShortWall_Band2_Straight: [0.0075, 1.9981, 4.0],
  ShortWall_DarkMetal2_Corner_Inner: [4.0, 2.0019, 4.0],
  ShortWall_DarkMetal2_Corner_Outer: [4.0, 2.0019, 4.0],
  ShortWall_DarkMetal2_Straight: [0.0, 2.0019, 4.0],
  ShortWall_DarkPlastic_Corner_Inner: [4.0, 0.9981, 4.0],
  ShortWall_DarkPlastic_Corner_Outer: [4.0, 0.9981, 4.0],
  ShortWall_DarkPlastic_Straight: [0.0, 0.9981, 4.0],
  ShortWall_Metal2_Corner_Inner: [4.0, 2.0, 4.0],
  ShortWall_Metal2_Corner_Outer: [4.0, 2.0, 4.0],
  ShortWall_Metal2_Straight: [0.0, 2.0, 4.0],
  ShortWall_MetalPlates_Corner_Inner: [4.0, 0.9981, 4.0],
  ShortWall_MetalPlates_Corner_Outer: [4.0, 0.9981, 4.0],
  ShortWall_MetalPlates_Straight: [0.0, 0.9981, 4.0],
  ShortWall_Simple1_Corner_Inner: [4.0, 0.9981, 4.0],
  ShortWall_Simple1_Corner_Outer: [4.0, 0.9981, 4.0],
  ShortWall_Simple1_Straight: [0.0, 0.9981, 4.0],
  ShortWall_Simple2_Corner_Inner: [4.0, 1.0, 4.0],
  ShortWall_Simple2_Corner_Outer: [4.0, 1.0, 4.0],
  ShortWall_Simple2_Straight: [0.0, 1.0, 4.0],
  ShortWall_Triangles_Corner_Inner: [4.0, 0.9981, 4.0],
  ShortWall_Triangles_Corner_Outer: [4.0, 0.9981, 4.0],
  ShortWall_Triangles_Straight: [0.0, 0.9981, 4.0],
  ShortWall_WhitePlate2_Corner_Inner: [4.0, 2.0019, 4.0],
  ShortWall_WhitePlate2_Corner_Outer: [4.0, 2.0019, 4.0],
  ShortWall_WhitePlate2_Straight: [0.0, 2.0019, 4.0],
  TopAstra_Corner_Round_Inner: [4.0, 2.0, 4.0],
  TopAstra_Curve_Round_Outer: [4.0, 2.0, 4.0],
  TopAstra_Straight: [0.0861, 2.0, 4.0],
  TopCables_Corner_Round_Inner: [4.1607, 2.0, 4.1606],
  TopCables_Corner_Round_Outer: [4.2153, 2.0, 4.2153],
  TopCables_Corner_Square_Inner: [4.1686, 2.0, 4.1686],
  TopCables_Corner_Square_Outer: [4.2153, 2.0, 4.2153],
  TopCables_Straight: [0.3839, 2.0, 4.0],
  TopCables_Straight_Hanging: [0.4421, 4.9432, 4.0],
  TopPlastic_Corner_Outer: [0.5705, 1.5, 0.5705],
  TopPlastic_Corner_Round_Inner: [4.0, 2.0177, 4.0],
  TopPlastic_Corner_Round_Outer: [4.5679, 2.0177, 4.5678],
  TopPlastic_Straight: [0.5679, 2.0177, 4.0],
  TopSimple_Corner_Round_Inner: [4.0, 2.0, 4.0],
  TopSimple_Corner_Round_Outer: [4.0, 2.0, 4.0],
  TopSimple_Straight: [0.0, 2.0, 4.0],
  TopWindow_Corner_Curve_Inner: [4.0988, 2.0203, 4.0987],
  TopWindow_Corner_Curve_Outer: [4.5705, 2.0203, 4.5705],
  TopWindow_Straight: [0.6693, 2.0203, 4.0],
  WallAstra_Corner_Round_Inner: [4.4651, 3.0438, 4.4684],
  WallAstra_Corner_Round_Outer: [4.0983, 3.0438, 4.1017],
  WallAstra_Corner_Square_Inner: [4.774, 3.028, 4.774],
  WallAstra_Corner_Square_Outer: [4.4353, 3.028, 4.4353],
  WallAstra_Straight: [1.2093, 3.028, 4.0],
  WallAstra_Straight_Broken: [1.4515, 3.028, 4.0],
  WallAstra_Straight_Divided: [1.2093, 3.028, 4.0],
  WallAstra_Straight_Flat: [0.1, 3.0, 4.0],
  WallAstra_Straight_Flat_Window: [0.5015, 3.0, 4.0],
  WallAstra_Straight_Window: [0.4975, 3.0, 4.0],
  WallBand_Corner_Round_Inner: [4.2, 3.0, 4.2],
  WallBand_Corner_Round_Outer: [4.0073, 3.0, 4.0],
  WallBand_Corner_Square_Inner: [4.2, 3.0, 4.2],
  WallBand_Corner_Square_Outer: [4.0075, 3.0, 4.0075],
  WallBand_Straight: [0.2075, 3.0, 4.0],
  WallBand_Straight_Broken: [0.679, 3.0117, 4.8233],
  WallWindow_Cap_A: [0.2008, 0.3958, 0.3954],
  WallWindow_Cap_B: [0.2008, 0.3958, 0.3954],
  WallWindow_Corner_Round_Inner: [4.2, 3.1691, 4.2],
  WallWindow_Corner_Round_Outer: [4.0083, 3.1612, 4.0083],
  WallWindow_Corner_Square_Inner: [4.2, 3.1866, 4.2],
  WallWindow_Corner_Square_Outer: [4.1201, 3.1866, 4.1201],
  WallWindow_Straight: [0.3201, 3.1866, 4.0],
  Column_Astra: [0.3278, 3.028, 1.2093],
  Column_Hollow: [1.2093, 5.0, 1.2093],
  Column_Large_Straight: [1.3965, 10.0032, 1.9622],
  Column_MetalSupport: [0.9566, 0.044, 4.0],
  Column_MetalSupport_Curve: [4.4709, 0.044, 4.471],
  Column_Pipes: [0.8746, 5.0, 0.8746],
  Column_Round: [1.0, 5.0, 1.0],
  Column_Simple: [0.5068, 5.0, 0.9749],
  Door_DarkMetal: [2.1057, 4.0489, 0.2032],
  Door_Frame_A: [4.8706, 5.1587, 0.9274],
  Door_Frame_Square: [4.8534, 5.0134, 0.5068],
  Door_Frame_SquareTall: [4.8437, 5.0134, 0.5068],
  Door_Frame_Square_Blocked: [4.8534, 5.0, 0.5068],
  Door_Metal: [2.1057, 4.0489, 0.1016],
  Door_Simple: [2.1057, 4.0489, 0.1363],
  Platform_3Plates: [4.0, 0.0, 4.0],
  Platform_CenterPlate: [4.0, 0.0, 4.0],
  Platform_CenterPlate_Curve: [4.0, 0.0, 4.0],
  Platform_DarkPlates: [4.0, 0.0, 4.0],
  Platform_DarkPlates_Curves: [4.0, 0.0, 4.0],
  Platform_Metal: [4, 0, 4],
  Platform_Metal2: [4, 0, 4],
  Platform_Metal2_Curve: [4.0, 0.0, 4.0],
  Platform_Metal_Curve: [4.0, 0.0, 4.0],
  Platform_Rails_2: [2.3584, 1.6984, 1.891],
  Platform_Rails_4: [2.3584, 2.7168, 3.8026],
  Platform_Rails_4Wide: [4.2467, 2.7168, 3.8026],
  Platform_Rails_4WideTall: [4.2467, 3.7198, 5.7308],
  Platform_Ramp_2: [2.0001, 1.0, 2.0],
  Platform_Ramp_2Short: [2.0001, 1.0, 1.5],
  Platform_Ramp_4: [2.0001, 2.0, 4.0],
  Platform_Ramp_4Wide: [4.0001, 2.0, 4.0],
  Platform_Round1: [5.9908, 0.1702, 5.9908],
  Platform_Simple: [4, 0, 4],
  Platform_Simple2: [4, 0, 4],
  Platform_Simple2_Curve: [4.0, 0.0, 4.0],
  Platform_Simple_Curve: [4.0, 0.0, 4.0],
  Platform_Squares: [4, 0, 4],
  Platform_Squares_Curve: [4.0, 0.0, 4.0],
  Platform_Stairs_2: [2.0001, 1.0086, 2.0727],
  Platform_Stairs_4: [2.0001, 2.0082, 4.0827],
  Platform_Stairs_4Wide: [4.0001, 2.0082, 4.0827],
  Platform_Stairs_4WideTall: [4.0001, 3.0082, 6.0827],
  Platform_Window_Thin: [2.8846, 0.4133, 4.0],
  Platform_Window_Wide: [4.0, 0.4133, 4.0],
  Platform_X: [4, 0, 4],
  Prop_AccessPoint: [0.4412, 0.4679, 1.2963],
  Prop_Barrel_Large: [0.5078, 1.1026, 0.532],
  Prop_Cable_1: [1.0185, 0.1482, 1.6469],
  Prop_Cable_3: [1.5599, 0.117, 5.7345],
  Prop_Chest: [1.5028, 0.729, 0.753],
  Prop_Clamp: [0.5605, 0.1617, 0.4602],
  Prop_Computer: [0.7434, 1.5928, 0.5625],
  Prop_Crate3: [1.0, 1.0, 1.0],
  Prop_Crate4: [1.1209, 1.1209, 1.1209],
  Prop_Fan_Small: [1.6768, 0.4424, 1.6768],
  Prop_ItemHolder: [1.0386, 0.4358, 1.0723],
  Prop_Light_Corner: [4.123, 0.1819, 4.2083],
  Prop_Light_Floor: [1.3331, 0.209, 0.5246],
  Prop_Light_Small: [0.8609, 0.1819, 0.4453],
  Prop_Light_Wide: [1.3202, 0.1819, 0.4453],
  Prop_PipeHolder: [4.1169, 0.9274, 1.1614],
  Prop_Rail_2: [0.0666, 0.8621, 1.9464],
  Prop_Rail_3: [0.0666, 0.8621, 2.9656],
  Prop_Rail_4: [0.0666, 0.8624, 3.9257],
  Prop_Rail_Incline_Long_L: [0.2545, 2.7168, 3.8026],
  Prop_Rail_Incline_Long_R: [0.2545, 2.7168, 3.8026],
  Prop_Rail_Incline_Short_L: [0.2545, 1.6984, 1.891],
  Prop_Rail_Incline_Short_R: [0.2545, 2.2985, 2.6014],
  Prop_Rail_Round_Big: [3.9964, 0.8624, 4.0489],
  Prop_Rail_Round_Small: [1.9937, 0.8623, 1.9662],
  Prop_Vent_Big: [2.0004, 0.0688, 0.9764],
  Prop_Vent_Small: [1.0, 0.0438, 0.6183],
  Prop_Vent_Wide: [1.9383, 0.0595, 0.291],
  Decal_0: [0.7681, 0.0, 1.2725],
  Decal_1: [0.5761, 0.0, 1.2725],
  Decal_2: [0.8038, 0.0, 1.2725],
  Decal_3: [0.7778, 0.0, 1.2725],
  Decal_4: [0.8142, 0.0, 1.2725],
  Decal_5: [0.7682, 0.0, 1.2725],
  Decal_6: [0.7814, 0.0, 1.2725],
  Decal_7: [0.7891, 0.0, 1.2725],
  Decal_8: [0.8338, 0.0, 1.2725],
  Decal_9: [0.7681, 0.0, 1.2725],
  Decal_A: [0.8874, 0.0, 1.2136],
  Decal_Dashes: [1.0735, 0.0, 0.3316],
  Decal_K: [0.9046, 0.0, 1.2136],
  Decal_Line_90: [2.0721, 0.0, 2.072],
  Decal_Line_90_Round: [2.072, 0.0, 2.072],
  Decal_Line_90_Round_Large: [3.072, 0.0, 3.072],
  Decal_Line_Bend1_L: [2.144, 0.0, 4.0],
  Decal_Line_Bend1_R: [2.144, 0.0, 4.0],
  Decal_Line_Bend2_L: [1.144, 0.0, 4.0],
  Decal_Line_Bend2_R: [1.144, 0.0, 4.0],
  Decal_Line_Straight: [0.144, 0.0, 4.0],
  Decal_Logo: [2.2922, 0.0, 1.4174],
  Decal_Logo_Letters: [2.9022, 0.0, 0.5868],
  Decal_Logo_Small: [0.7639, 0.0, 0.4769],
  Decal_Sign: [0.6894, 0.0, 0.6156],
  Decal_V: [0.866, 0.0, 1.2136],
  Decal_X: [0.8648, 0.0, 1.2136],
  Decal_XSign: [0.3615, 0.0, 0.3424],
  Decal_Z: [0.7181, 0.0, 1.2136],
  // --- assets/more-scifi ------------------------------------------------------
  // The same pack's prop half: crates, drums, lockers, shelves, a dish. Same
  // authoring scale, same trim sheets (the texture files are byte-identical to
  // the environment set's), so it is one kit and one table -- which is the only
  // reason it may stand in a level that has a rule about not mixing styles.
  Enemy_EyeDrone: [0.9965, 0.9955, 0.8923],
  Enemy_QuadShell: [2.0153, 1.4943, 1.9705],
  Enemy_Trilobite: [2.5411, 2.4927, 2.7169],
  Gun_Pistol: [0.4425, 0.2523, 0.0685],
  Gun_Revolver: [0.5306, 0.2616, 0.0814],
  Gun_Rifle: [1.0599, 0.3739, 0.087],
  Gun_SMG_Ammo: [0.0642, 0.2772, 0.0391],
  Gun_Sniper: [1.7176, 0.3299, 0.0592],
  Gun_Sniper_Ammo: [0.1384, 0.1546, 0.0275],
  Prop_Ammo: [0.5707, 0.2819, 0.7229],
  Prop_Ammo_Closed: [0.5707, 0.4122, 0.7229],
  Prop_Ammo_Small: [0.4023, 0.2834, 0.4338],
  Prop_Barrel1: [0.722, 1.1111, 0.6485],
  Prop_Barrel2_Closed: [0.5422, 0.7661, 0.5422],
  Prop_Barrel2_Open: [0.5422, 1.096, 0.5422],
  Prop_Chair: [0.8807, 1.6417, 1.1224],
  Prop_Crate: [1.569, 1.5, 1.5],
  Prop_Crate_Large: [3.466, 1.5, 1.5],
  Prop_Crate_Tarp: [1.7168, 1.5676, 1.7149],
  Prop_Crate_Tarp_Large: [3.2196, 1.5676, 1.7168],
  Prop_Desk_L: [2.2222, 0.9396, 2.2222],
  Prop_Desk_Medium: [2.8431, 0.9396, 1.0289],
  Prop_Desk_Small: [2.0635, 0.9396, 1.0289],
  Prop_Grenade: [0.1272, 0.2409, 0.087],
  Prop_HealthPack: [0.4307, 0.6013, 0.1745],
  Prop_HealthPack_Tube: [0.1495, 0.3146, 0.1495],
  Prop_KeyCard: [0.1815, 0.4757, 0.0484],
  Prop_Locker: [0.983, 2.6685, 0.4994],
  Prop_Mine: [0.8056, 0.8162, 0.6982],
  Prop_Mug: [0.1825, 0.1718, 0.1325],
  Prop_SatelliteDish: [1.8401, 5.7949, 2.7792],
  Prop_Shelves_ThinShort: [1.3724, 1.2104, 0.5407],
  Prop_Shelves_ThinTall: [1.3724, 2.67, 0.5407],
  Prop_Shelves_WideShort: [1.9765, 1.2104, 0.5407],
  Prop_Shelves_WideTall: [1.9765, 2.67, 0.5407],
  Prop_Syringe: [0.114, 0.6525, 0.114],
};

/**
 * World-space size of a sci-fi prop, for a brush that will hold it without
 * distortion. `scale` is a UNIFORM multiplier -- scaling a model evenly is not
 * distortion, it is a bigger version of the same object, and the verifier
 * checks the three axes against each other rather than against 1.
 */
export function sciBox(name: string, scale = 1): [number, number, number] {
  const n = SCIFI[name];
  if (!n) throw new Error(`unknown scifi model: ${name}`);
  return [n[0] * scale, n[1] * scale, n[2] * scale];
}

/**
 * Some panels and every decal are modelled as single planes with NO thickness.
 * A zero axis makes the brush degenerate and the unit fit divide by zero, so a
 * plane gets this much to sit in; the model is centred, so it ends up in the
 * middle of a very thin slab.
 */
export const MIN_THICK = 0.08;
/** Below this an axis counts as absent rather than merely thin. */
const FLAT = 1e-3;

/**
 * The same box, with any ZERO axis opened up to something a brush can be.
 *
 * Only zero. Clamping every axis to a minimum instead looks harmless and is
 * not: a vent modelled 44 mm thick came out at 80 mm while its other two axes
 * stayed put, which is an 83% stretch on one axis — exactly the distortion this
 * whole table exists to prevent, introduced by the function meant to protect
 * it. A 44 mm cuboid is a perfectly good collider.
 */
export function sciBrush(name: string, scale = 1): [number, number, number] {
  const s = sciBox(name, scale);
  return [
    s[0] > FLAT ? s[0] : MIN_THICK,
    s[1] > FLAT ? s[1] : MIN_THICK,
    s[2] > FLAT ? s[2] : MIN_THICK,
  ];
}
