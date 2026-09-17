import type { InkTeamName, LobbyChange, MinigameLobby, PlayerId } from '../../shared/protocol.ts'
import type { Refusal } from '../../shared/legality.ts'

/** Returns whether the lobby changed. */
export function applyLobby(lobby: MinigameLobby, playerId: PlayerId, change: LobbyChange): boolean {
  const team = lobby.teams[playerId]
  const volunteering = lobby.volunteers.includes(playerId)
  const unvolunteer = () => { lobby.volunteers = lobby.volunteers.filter((id) => id !== playerId) }
  if (change.do === 'join') {
    if (change.team !== 'sun' && change.team !== 'moon') return false
    if (team === change.team) return false
    lobby.teams[playerId] = change.team
    unvolunteer()
    return true
  }
  if (change.do === 'leave') {
    if (!team) return false
    delete lobby.teams[playerId]
    unvolunteer()
    return true
  }
  if (change.do === 'volunteer') {
    if (!team || change.on === volunteering) return false
    if (change.on) lobby.volunteers.push(playerId)
    else unvolunteer()
    return true
  }
  return false
}

export function teamMembers(lobby: MinigameLobby, connected: PlayerId[], team: InkTeamName): PlayerId[] {
  return connected.filter((id) => lobby.teams[id] === team)
}

export function lobbyStartable(lobby: MinigameLobby, connected: PlayerId[]): Refusal | null {
  if (connected.some((id) => !lobby.teams[id])) return 'unpicked'
  if (teamMembers(lobby, connected, 'sun').length < 2 || teamMembers(lobby, connected, 'moon').length < 2) return 'team-too-small'
  return null
}
