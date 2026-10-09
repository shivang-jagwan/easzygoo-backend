/**
 * Design tokens.
 *
 * `light` is the canonical shape — ThemeColors is derived from it, so any token
 * added here must also be added to `dark`. `dark` additionally carries
 * `backgroundSecondary`, which has no light-mode counterpart.
 */

export const light = {
  background: '#FDFDFC',
  card: '#ECF3E1',
  primaryGreen: '#396C11',
  button: '#2F7D18',
  buttonText: '#FFFFFF',
  text: '#10200F',
  textSecondary: '#555555',
  border: '#E5E5E5',
  success: '#4BAE20',
  offerBackground: '#E8F5D8',
};

export const dark = {
  background: '#121820',
  backgroundSecondary: '#162F1E',
  card: '#18212B',
  primaryGreen: '#73A624',
  button: '#59B52B',
  buttonText: '#FFFFFF',
  text: '#F1F2F1',
  textSecondary: '#BFC2C1',
  border: '#29333D',
  success: '#4BAE20',
  offerBackground: '#12351D',
};

/**
 * Brand marks. These NEVER change between themes and are for the logo and
 * brand identity only — never backgrounds, buttons, or body text.
 */
export const brand = {
  yellow: '#F9C900',
  blue: '#123D91',
  green: '#73A624',
};

export type ThemeColors = typeof light;
export type Brand = typeof brand;
