{
  lib,
  buildNpmPackage,
  nodejs,
  makeWrapper,
}:

buildNpmPackage {
  pname = "rust-storage-dashboard";
  version = "1.0.0";

  src = lib.cleanSource ../.;

  npmDepsHash = "sha256-ryd55aXHQlW9XwlRwL3z7xhAqLIhGYFRpgM10Vndvag=";

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/rust-storage-dashboard $out/bin

    cp -r . $out/lib/rust-storage-dashboard/

    # Patch itemIsBlueprint to optional — Rust+ doesn't always include it
    sed -i 's/required bool itemIsBlueprint/optional bool itemIsBlueprint/g' \
      $out/lib/rust-storage-dashboard/node_modules/@liamcottle/rustplus.js/rustplus.proto

    makeWrapper ${lib.getExe nodejs} $out/bin/rust-storage-dashboard \
      --add-flags "$out/lib/rust-storage-dashboard/server.js"

    runHook postInstall
  '';

  meta = {
    description = "Rust+ storage monitor combined inventory dashboard";
    license = lib.licenses.mit;
    mainProgram = "rust-storage-dashboard";
    platforms = lib.platforms.linux;
  };
}
