import Speech
import AVFoundation
import Foundation

let args = CommandLine.arguments
let sessionMode = args.count > 2 && args[1] == "--session"
guard args.count > 1 else {
    FileHandle.standardError.write("usage: stt [--session] <audio-file>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: sessionMode ? args[2] : args[1])
let fail = { (msg: String, _ code: Int32) -> Never in
    FileHandle.standardError.write("\(msg)\n".data(using: .utf8)!)
    exit(code)
}

func pump(until ready: () -> Bool, seconds: Double) {
    let deadline = Date().addingTimeInterval(seconds)
    while !ready() && Date() < deadline {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.01))
    }
}

var recognizer: SFSpeechRecognizer?

func speechRecognizer() -> SFSpeechRecognizer? {
    if let recognizer { return recognizer }
    var authDone = false
    SFSpeechRecognizer.requestAuthorization { status in
        if status == .authorized,
           let candidate = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), candidate.isAvailable {
            recognizer = candidate
        }
        authDone = true
    }
    pump(until: { authDone }, seconds: 30)
    return recognizer
}

let file: AVAudioFile
do { file = try AVAudioFile(forReading: url) } catch {
    fail("read: \(error.localizedDescription)", 1)
}
let rate = file.processingFormat.sampleRate

func transcribe(fromMs: Int, toMs: Int) -> String? {
    let first = max(0, AVAudioFramePosition(Double(fromMs) / 1000.0 * rate))
    let last = min(file.length, AVAudioFramePosition(Double(toMs) / 1000.0 * rate))
    guard last > first else { return "" }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat,
                                        frameCapacity: AVAudioFrameCount(last - first)) else {
        return nil
    }
    do {
        file.framePosition = first
        try file.read(into: buffer, frameCount: AVAudioFrameCount(last - first))
    } catch {
        return nil
    }
    guard let recognizer = speechRecognizer() else { return nil }

    let request = SFSpeechAudioBufferRecognitionRequest()
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    var out: String?
    var failed = false
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error {
            if !sessionMode {
                FileHandle.standardError.write("stt: \(error.localizedDescription) [\((error as NSError).domain) \((error as NSError).code)]\n".data(using: .utf8)!)
            }
            out = ""
            failed = true
            return
        }
        guard let result, result.isFinal else { return }
        out = result.bestTranscription.formattedString
    }
    request.append(buffer)
    request.endAudio()
    pump(until: { out != nil }, seconds: 30)
    task.cancel()
    _ = failed
    return out
}

func emit(_ s: String) {
    FileHandle.standardOutput.write("\(s)\n".data(using: .utf8)!)
}

if sessionMode {
    while let line = readLine(strippingNewline: true) {
        let parts = line.split(separator: " ")
        guard parts.count == 2, let from = Int(parts[0]), let to = Int(parts[1]) else {
            FileHandle.standardError.write("bad range: \(line)\n".data(using: .utf8)!)
            emit("")
            continue
        }
        emit(transcribe(fromMs: from, toMs: to) ?? "")
    }
    exit(0)
}

guard let text = transcribe(fromMs: 0, toMs: Int(Double(file.length) / rate * 1000) + 1) else {
    fail("recognition failed", 1)
}
print(text)
exit(0)
