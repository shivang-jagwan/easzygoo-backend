import { Image, StyleSheet, View } from 'react-native';

const SIZE = 44;

/**
 * The EaszyGoo brand mark. Identical in both themes — brand colours never
 * change with the palette.
 *
 * The source asset is a JPEG with no alpha, so it carries an opaque near-white
 * margin around the yellow tile. That margin would read as a white box on the
 * dark background, so the image is overscaled inside a rounded, clipped
 * container: the margin is pushed outside the frame and only the tile shows.
 * Swap in a transparent PNG and this can become a plain <Image>.
 */
export default function Logo() {
  return (
    <View style={styles.frame}>
      <Image
        source={require('../../assets/easzygoo.jpeg')}
        style={styles.image}
        resizeMode="cover"
        accessibilityRole="image"
        accessibilityLabel="EaszyGoo"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE * 0.28,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    // Crops the JPEG's white margin out of the rounded frame.
    transform: [{ scale: 1.32 }],
  },
});
