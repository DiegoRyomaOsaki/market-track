/**
 * Jest con el preset de jest-expo: el móvil no usa Vitest (que sí corre en la web
 * y en packages) porque necesita el runtime de React Native y sus mocks nativos.
 *
 * Sin `passWithNoTests`: el default (false) es lo único que impide que la suite se
 * vuelva un verde falso si alguien borra el último test.
 */
module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))",
  ],
};
