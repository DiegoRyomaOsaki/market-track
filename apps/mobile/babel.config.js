// El plugin de async generators lo pide PowerSync para sus watched queries en
// Expo (el polyfill @azure/core-asynciterator-polyfill se importa en el arranque).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["@babel/plugin-transform-async-generator-functions"],
  };
};
