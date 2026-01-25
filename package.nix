{
  pkgs,
  buildPnpmPackage,
  ...
}:
buildPnpmPackage {
  src = ./.;
  pnpmDepsHash = "sha256-FCsH+L0/nm62ccZiyy8H4q5xnYss3d70YbJlv1V+lzg=";

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
