// La forme du corps 3D, sans le maillage : ce que l'estimation calcule et ce que le rendu applique. Fichier léger,
// pour que l'écran de progression n'embarque pas la silhouette tant que le corps 3D n'est pas affiché.

/** Les zones qui grossissent avec l'entraînement, dans l'ordre des forces envoyées au maillage. */
export const CHANNELS = ['chest', 'delts', 'arms', 'back', 'traps', 'quads', 'posterior', 'calves'] as const;
export type Channel = (typeof CHANNELS)[number];

export interface BodyShape {
  /** Épaisseur ajoutée (m) au milieu de chaque zone, dans l'ordre de CHANNELS ; négatif : plus fin. */
  muscle: number[];
  /** Épaisseur de gras ajoutée (m) là où il se dépose le plus ; négatif : plus sec. */
  fat: number;
  /** 1 : silhouette féminine (poitrine, hanches, taille, épaules). */
  female: number;
}

export const NEUTRAL: BodyShape = { muscle: CHANNELS.map(() => 0), fat: 0, female: 0 };

/** Entre deux formes (pour passer de l'une à l'autre en douceur). */
export function mixShape(a: BodyShape, b: BodyShape, t: number): BodyShape {
  return {
    muscle: a.muscle.map((v, i) => v + (b.muscle[i] - v) * t),
    fat: a.fat + (b.fat - a.fat) * t,
    female: a.female + (b.female - a.female) * t,
  };
}
