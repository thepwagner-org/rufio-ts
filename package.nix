{
  pkgs,
  buildPnpmPackage,
  ...
}:
buildPnpmPackage {
  src = ./.;
  pnpmDepsHash = "sha256-WG+hcnG+KJtaQjlgLXLzPSWI4IWowsts7pzjr0b9kg0=";

  extraNativeBuildInputs = [ pkgs.esbuild ];

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
