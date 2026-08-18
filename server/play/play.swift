// Play a clip, optionally from part way in.
//
// `afplay` cannot seek, and it did not need to while every fragment was its own
// clip: an interruption killed the clip and the fragment played again from its
// start. A question read as one breath is one clip, so every resume after a
// pause or a buzz is a seek into the middle of it.
//
// Built by swiftc at server boot; see speech.ts. Without it playback falls back
// to `afplay` and a resume starts the question over.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: play <audio-file> [fromSeconds]\n".data(using: .utf8)!)
    exit(2)
}
guard let player = try? AVAudioPlayer(contentsOf: URL(fileURLWithPath: args[1])) else {
    FileHandle.standardError.write("cannot open \(args[1])\n".data(using: .utf8)!)
    exit(1)
}
player.prepareToPlay()
if args.count > 2, let from = Double(args[2]) {
    player.currentTime = min(max(0, from), player.duration)
}
guard player.play() else {
    FileHandle.standardError.write("cannot play\n".data(using: .utf8)!)
    exit(1)
}

// The caller times the reveal off this line, not off the spawn: process start
// is tens of milliseconds and the board must never run ahead of the voice.
FileHandle.standardOutput.write("playing\n".data(using: .utf8)!)

while player.isPlaying {
    RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02))
}
exit(0)
