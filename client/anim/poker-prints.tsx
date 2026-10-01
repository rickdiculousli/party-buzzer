/** Development-only: the actual component/fonts/tokens are the texture source. */
import { render } from 'preact'
import { PlayingCard } from '../PokerParts.tsx'

const params = new URLSearchParams(location.search)
const root = document.getElementById('app')!
root.dataset.side = params.get('side') ?? 'face'
render(<PlayingCard card={params.get('card') ?? 'As'} up peek />, root)
void document.fonts.ready.then(() => { root.dataset.ready = 'true' })
