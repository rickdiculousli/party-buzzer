export function JoinCode({ small = false, finale = false }: { small?: boolean; finale?: boolean }) {
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
  return (
    <div data-review-id="board:join" class={small ? 'board__qr is-small' : 'board__qr fx-glow-pulse'}>
      <img src={finale ? '/recap.svg' : '/qr.svg'} alt={finale ? 'Scan to keep the night' : 'Scan to join'} />
      <p>{finale ? 'Scan to keep the night' : 'Scan to join'}</p>
      {!small && !finale && !loopback && (
        <>
          <p class="board__addr">
            <span class="board__addr-dim">{location.protocol}//</span>
            <span>{location.hostname}</span>
            {location.port && <span class="board__addr-dim">:{location.port}</span>}
          </p>
          <p class="board__addr-hint">or type the address</p>
        </>
      )}
    </div>
  )
}
