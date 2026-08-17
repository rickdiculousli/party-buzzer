// One audio file in (argv 1), one transcript out (stdout). On-device, so party
// WiFi — which has no route to the internet — is enough. Built by swiftc at
// server boot; see server/stt.ts.
import Speech
import AVFoundation
import Foundation

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: stt <audio-file>\n".data(using: .utf8)!)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let fail = { (msg: String, _ code: Int32) -> Never in
    FileHandle.standardError.write("\(msg)\n".data(using: .utf8)!)
    exit(code)
}

SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else { fail("speech recognition not authorized (\(status.rawValue))", 1) }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
        fail("recognizer unavailable", 1)
    }
    let request = SFSpeechAudioBufferRecognitionRequest()
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error { fail("recognition: \(error.localizedDescription)", 1) }
        guard let result, result.isFinal else { return }
        print(result.bestTranscription.formattedString)
        exit(0)
    }
    _ = task
    do {
        let file = try AVAudioFile(forReading: url)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat,
                                            frameCapacity: AVAudioFrameCount(file.length)) else {
            fail("buffer alloc failed", 1)
        }
        try file.read(into: buffer)
        request.append(buffer)
        request.endAudio()
    } catch {
        fail("read: \(error.localizedDescription)", 1)
    }
}

DispatchQueue.global().asyncAfter(deadline: .now() + 30) { fail("timeout", 1) }
// XPC to speechd is set up on the main runloop. Parking the main thread on a
// semaphore starves it, and the task then never calls back — the one failure
// mode the spike actually hit.
RunLoop.main.run()
