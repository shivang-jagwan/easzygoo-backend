// Autolinking resolves the `expo` package's Android packageImportPath to
// `expo.core.ExpoModulesPackage` — the SDK-40-era name. In SDK 52 the class is
// `expo.modules.ExpoModulesPackage`
// (expo/android/src/main/java/expo/modules/ExpoModulesPackage.kt), and expo's own
// react-native.config.js reports that correctly; something in the autolinking
// chain is still emitting the legacy path, which makes the generated
// PackageList.java fail to compile. Pin the correct one here.
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
          packageInstance: 'new ExpoModulesPackage()',
        },
      },
    },
  },
};
