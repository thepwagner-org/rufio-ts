{pkgs, ...}:
with pkgs;
mkShell {
  buildInputs = [
    biome
    nodejs
    pnpm
    typescript
    typescript-language-server
  ];
}
