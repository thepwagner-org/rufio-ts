{pkgs, ...}:
pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
    pkgs.pnpm
    pkgs.typescript
    pkgs.typescript-language-server
  ];
}
