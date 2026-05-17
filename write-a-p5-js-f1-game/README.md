# Silverstone Apex GP

A pixel-styled top-down Formula racing game built with p5.js.

## Play

Open `index.html` through a static server, or publish the repository with GitHub Pages.

## Controls

- Drive: arrow keys or WASD
- Options: `O`
- Camera: `C`
- Autodrive: `V`
- Minimap: `M`
- Racing line: `L`
- Tire pit stop: `T`

Split screen can be enabled from the boot menu:

- P1: WASD
- P2: arrow keys

Touch controls appear automatically on mobile-sized screens.

## Development

The playable game is generated into `game.js`.

```sh
node tools/build-game.js
```

Then serve the folder:

```sh
python3 -m http.server 5173
```

