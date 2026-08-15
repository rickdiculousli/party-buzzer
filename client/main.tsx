import { render } from 'preact'
import { Player } from './Player.tsx'
import { Host } from './Host.tsx'
import { Board } from './Board.tsx'
import { ModeSwitch } from './modes/Switch.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <Host />
  if (path === '/board') return <ModeSwitch surface="Board" fallback={Board} />
  return <ModeSwitch surface="Player" fallback={Player} />
}

render(<App />, document.getElementById('app')!)
