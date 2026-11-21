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

FileHandle.standardOutput.write("playing\n".data(using: .utf8)!)

while player.isPlaying {
    RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02))
}
exit(0)
