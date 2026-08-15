import { render } from 'preact'
import { Player } from './Player.tsx'

function App() {
  const path = location.pathname
  if (path === '/host') return <p>host</p>
  if (path === '/board') return <p>board</p>
  return <Player />
}

render(<App />, document.getElementById('app')!)
