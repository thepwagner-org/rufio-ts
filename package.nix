{
  pkgs,
  buildPnpmPackage,
  ...
}:
buildPnpmPackage {
  src = ./.;
  pnpmDepsHash = "sha256-FuNoLCU+32HgtA/19rf8nJysiG76uIiIRsJIblnrRA4=";

  installPhase = ''
    runHook preInstall
    install -Dm644 dist/plugin.js $out/plugin.js
    runHook postInstall
  '';

  extraArgs = {
    meta = with pkgs.lib; {
      description = "OpenCode plugin that enforces lint checks before stopping";
      license = licenses.isc;
      platforms = platforms.all;
      mainProgram = "plugin.js";
    };
  };
}
