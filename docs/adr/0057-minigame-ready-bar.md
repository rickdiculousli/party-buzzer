# The minigame Ready bar reserves its own height

While the shared Ready bar is up on a minigame phone, the game surface is the screen minus the bar and scrolls inside that space, so Volunteer, a foot or a stick never sits under the button. The reserved padding is one Ready button (`min-height: 3.5rem`) plus the bar's padding and safe-area inset; change them together.

Where: `client/style.css` (`.minigame-ready`, `.minigame-stage--ready`, `.minigame-ready__btn`)
