{pkgs, ...}:
with pkgs;
  mkShell {
    buildInputs = [
      biome
      esbuild
      nodejs
      pnpm
      typescript
      typescript-language-server
    ];
  }
