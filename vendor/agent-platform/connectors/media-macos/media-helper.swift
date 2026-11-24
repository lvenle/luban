import Foundation
import AppKit
import Vision
import AVFoundation
import Speech

struct Request: Codable { let operation: String; let path: String; let root: String; let extractFrames: Bool?; let maxFrames: Int? }

func fail(_ message: String) { print((try? String(data: JSONSerialization.data(withJSONObject: ["ok": false, "error": message]), encoding: .utf8)) ?? "{\"ok\":false}"); fflush(stdout) }
func validURL(_ request: Request) -> URL? {
    let root = URL(fileURLWithPath: request.root).standardizedFileURL
    let file = URL(fileURLWithPath: request.path).standardizedFileURL
    guard file.path == root.path || file.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath: file.path) else { return nil }
    return file
}
func output(_ value: [String: Any]) { guard let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { fail("结果序列化失败"); return }; print(text); fflush(stdout) }

func image(_ url: URL) throws -> [String: Any] {
    var lines = [String](); var boxes = [[String: Double]]()
    let request = VNRecognizeTextRequest { req, _ in
        for observation in req.results as? [VNRecognizedTextObservation] ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            lines.append(candidate.string)
            // 归一化坐标（原点左下）。调用方按位置区分「语音气泡下面的转写」和旁人消息。
            let box = observation.boundingBox
            boxes.append(["x": box.origin.x, "y": box.origin.y, "w": box.size.width, "h": box.size.height])
        }
    }
    request.recognitionLevel = .accurate; request.usesLanguageCorrection = true
    // 默认语言是英文，中文（微信聊天内容、会话标题）会整段漏掉。
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
    try VNImageRequestHandler(url: url, options: [:]).perform([request])
    return ["path": url.path, "text": lines.joined(separator: "\n"), "lines": lines, "boxes": boxes]
}
func video(_ request: Request, _ url: URL) throws -> [String: Any] {
    let asset = AVURLAsset(url: url); let seconds = CMTimeGetSeconds(asset.duration)
    var result: [String: Any] = ["path": url.path, "durationSeconds": seconds.isFinite ? seconds : 0, "tracks": asset.tracks.map { ["mediaType": $0.mediaType.rawValue, "width": $0.naturalSize.width, "height": $0.naturalSize.height] }]
    guard request.extractFrames == true, seconds.isFinite, seconds > 0 else { return result }
    let folder = URL(fileURLWithPath: request.root).appendingPathComponent(".media-frames", isDirectory: true); try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let generator = AVAssetImageGenerator(asset: asset); generator.appliesPreferredTrackTransform = true; let count = min(max(request.maxFrames ?? 4, 1), 12); var paths = [String]()
    for index in 0..<count { let time = CMTime(seconds: seconds * Double(index) / Double(max(count - 1, 1)), preferredTimescale: 600); let cg = try generator.copyCGImage(at: time, actualTime: nil); let destination = folder.appendingPathComponent("frame-\(index + 1).png"); guard let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else { continue }; try data.write(to: destination, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path); paths.append(destination.path) }
    result["frames"] = paths; return result
}
func audio(_ url: URL, _ done: @escaping (Result<[String: Any], Error>) -> Void) {
    SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else { done(.failure(NSError(domain: "media", code: 1, userInfo: [NSLocalizedDescriptionKey: "未获得 macOS 语音识别授权。"]))); return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")), recognizer.isAvailable else { done(.failure(NSError(domain: "media", code: 2, userInfo: [NSLocalizedDescriptionKey: "macOS 语音识别当前不可用。"]))); return }
        let request = SFSpeechURLRecognitionRequest(url: url); request.shouldReportPartialResults = false
        recognizer.recognitionTask(with: request) { result, error in
            if let error { done(.failure(error)); return }; guard let result, result.isFinal else { return }; done(.success(["path": url.path, "text": result.bestTranscription.formattedString]))
        }
    }
}

while let line = readLine() {
    guard let data = line.data(using: .utf8), let request = try? JSONDecoder().decode(Request.self, from: data), let url = validURL(request) else { fail("媒体请求无效或路径不在任务目录内"); continue }
    do {
        if request.operation == "image" { output(try image(url)) }
        else if request.operation == "video" { output(try video(request, url)) }
        else if request.operation == "audio" { audio(url) { result in switch result { case .success(let value): output(value); case .failure(let error): fail(error.localizedDescription) } } }
        else { fail("不支持的媒体操作") }
    } catch { fail(error.localizedDescription) }
}
