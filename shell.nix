{pkgs, ...}:
with pkgs;
  mkShell {
    buildInputs = [
      biome
      esbuild
      nodejs
      pnpm_10
      typescript
      typescript-language-server
    ];
  }
