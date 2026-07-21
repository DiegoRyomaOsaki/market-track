// React 19 solo habilita act(...) —y con ello renderHook/render de Testing
// Library— si esta marca está puesta antes de que React cargue. jest-expo no la
// pone, así que va aquí, en setupFiles (corre antes de importar el módulo de test).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
