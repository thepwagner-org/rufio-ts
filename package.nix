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

    # Install the bundled plugin
    install -Dm644 dist/plugin.js $out/plugin.js

    # Optionally install types and other dist files
    mkdir -p $out/share/rufio-ts
    cp -r dist/* $out/share/rufio-ts/

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
