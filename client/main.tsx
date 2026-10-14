import { render } from 'preact'
import { Player } from './Player.tsx'
import { Host } from './Host.tsx'
import { Board } from './Board.tsx'
import { Recap } from './Recap.tsx'
import { setSurfaceGain } from './sound.ts'

function App() {
  const path = location.pathname
  if (path === '/host') return <Host />
  if (path === '/board') return <Board />
  if (path === '/recap') return <Recap />
  setSurfaceGain(0.5)
  return <Player />
}

render(<App />, document.getElementById('app')!)
