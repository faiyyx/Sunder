/*
 * Sunder Enterprise — Fabric Colour Palette
 * ------------------------------------------
 * SINGLE SOURCE OF TRUTH for every colour offered on the site.
 * The palette is deliberately limited: 21 stocked shades, nothing else.
 *
 * Each entry carries three tones so the cloth renderer can build a
 * believable pile:
 *   base   — the flat dyed colour of the cloth
 *   sheen  — the colour where light catches the nap (velvet highlight)
 *   shade  — the colour in the fold / against the nap
 *
 * `ink` says which text colour sits legibly on the swatch.
 */

export const FAMILIES = [
  { id: 'all',      label: 'All shades' },
  { id: 'neutral',  label: 'Neutrals'   },
  { id: 'red',      label: 'Reds'       },
  { id: 'pink',     label: 'Pinks'      },
  { id: 'blue',     label: 'Blues'      },
  { id: 'green',    label: 'Greens'     },
  { id: 'purple',   label: 'Purples'    },
  { id: 'warm',     label: 'Warms'      },
];

export const COLORS = [
  { slug: 'black',         name: 'Black',         family: 'neutral', base: '#16171B', sheen: '#3A3C42', shade: '#08090B', ink: 'light' },
  { slug: 'maroon',        name: 'Maroon',        family: 'red',     base: '#6E1524', sheen: '#9C2C3E', shade: '#3F0912', ink: 'light' },
  { slug: 'purple',        name: 'Purple',        family: 'purple',  base: '#4B1C66', sheen: '#6E3690', shade: '#2A0E3B', ink: 'light' },
  { slug: 'plum',          name: 'Plum',          family: 'purple',  base: '#5E2A46', sheen: '#85436A', shade: '#371828', ink: 'light' },
  { slug: 'zinc',          name: 'Zinc',          family: 'neutral', base: '#6F757D', sheen: '#979DA5', shade: '#474C53', ink: 'light' },
  { slug: 'navy-blue',     name: 'Navy Blue',     family: 'blue',    base: '#1B2A4E', sheen: '#35497A', shade: '#0E1830', ink: 'light' },
  { slug: 'royal-blue',    name: 'Royal Blue',    family: 'blue',    base: '#2331AE', sheen: '#4553D6', shade: '#141C74', ink: 'light' },
  { slug: 'red',           name: 'Red',           family: 'red',     base: '#C5202A', sheen: '#E44A48', shade: '#7E1219', ink: 'light' },
  { slug: 'grey',          name: 'Grey',          family: 'neutral', base: '#8B9097', sheen: '#B2B7BD', shade: '#5E6369', ink: 'light' },
  { slug: 'brown',         name: 'Brown',         family: 'warm',    base: '#4C3023', sheen: '#714A38', shade: '#2C1A12', ink: 'light' },
  { slug: 'pink',          name: 'Pink',          family: 'pink',    base: '#E0698D', sheen: '#F294AF', shade: '#A94465', ink: 'dark'  },
  { slug: 'baby-pink',     name: 'Baby Pink',     family: 'pink',    base: '#F4BCCB', sheen: '#FCDBE4', shade: '#D08FA3', ink: 'dark'  },
  { slug: 'cream',         name: 'Cream',         family: 'neutral', base: '#F0E3C6', sheen: '#FAF3E2', shade: '#CBB994', ink: 'dark'  },
  { slug: 'off-white',     name: 'Off White',     family: 'neutral', base: '#F2EEE5', sheen: '#FCFAF5', shade: '#D2CCBE', ink: 'dark'  },
  { slug: 'white',         name: 'White',         family: 'neutral', base: '#FBFBF8', sheen: '#FFFFFF', shade: '#DCDCD6', ink: 'dark'  },
  { slug: 'green',         name: 'Green',         family: 'green',   base: '#1F7040', sheen: '#359760', shade: '#114226', ink: 'light' },
  { slug: 'dark-green',    name: 'Dark Green',    family: 'green',   base: '#123F27', sheen: '#236240', shade: '#082516', ink: 'light' },
  { slug: 'yellow',        name: 'Yellow',        family: 'warm',    base: '#E8B21E', sheen: '#F7CE55', shade: '#B0800D', ink: 'dark'  },
  { slug: 'ferozi',        name: 'Ferozi',        family: 'green',   base: '#0E8079', sheen: '#1FA79E', shade: '#064F4B', ink: 'light' },
  { slug: 'shocking-pink', name: 'Shocking Pink', family: 'pink',    base: '#E8117F', sheen: '#FA47A2', shade: '#A80759', ink: 'light' },
  { slug: 'orange',        name: 'Orange',        family: 'warm',    base: '#D9822B', sheen: '#F0A64F', shade: '#A45B15', ink: 'dark'  },
];

/** Colours grouped for the family filter, in palette order. */
export function byFamily(id) {
  return id === 'all' ? COLORS : COLORS.filter((c) => c.family === id);
}

export function findColor(slug) {
  return COLORS.find((c) => c.slug === slug) || null;
}

export default COLORS;
