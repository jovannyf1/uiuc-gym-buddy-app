import Foundation
import Combine
import AuthenticationServices
import CryptoKit
import Security
import UIKit

struct APIError: LocalizedError {
    let message: String
    let statusCode: Int?
    var errorDescription: String? { message }
}

private struct ErrorEnvelope: Decodable { let error: String }

final class APIClient {
    var baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpCookieAcceptPolicy = .always
        configuration.httpShouldSetCookies = true
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    func encode<T: Encodable>(_ value: T) throws -> Data { try encoder.encode(value) }

    func clearSessionCookie() {
        for cookie in HTTPCookieStorage.shared.cookies(for: baseURL) ?? []
        where cookie.name == "uiuc_gym_buddy_session" {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return try await perform(request)
    }

    func uploadPreview(data: Data, filename: String, mimeType: String) async throws -> ImportPreview {
        let boundary = "IlliniWorkoutBuddy-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))

        var request = URLRequest(url: baseURL.appendingPathComponent("api/import/preview"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body
        return try await perform(request)
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(message: "Could not reach the app server. Check its address and your connection.", statusCode: nil)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: "The server returned an invalid response.", statusCode: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(ErrorEnvelope.self, from: data).error)
                ?? "The request failed (\(http.statusCode))."
            throw APIError(message: message, statusCode: http.statusCode)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(message: "The app could not read the server response. Update the app and try again.", statusCode: http.statusCode)
        }
    }
}

@MainActor
private final class NetIDBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }

    func authorizationCode(from url: URL) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "uiucgymbuddy") { [weak self] callback, error in
                Task { @MainActor in
                    self?.session = nil
                    if let error {
                        continuation.resume(throwing: error)
                        return
                    }
                    guard let callback,
                          callback.scheme == "uiucgymbuddy",
                          callback.host == "auth-callback",
                          let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                            .queryItems?.first(where: { $0.name == "code" })?.value,
                          !code.isEmpty else {
                        continuation.resume(throwing: APIError(message: "Illinois sign-in did not return an authorization code.", statusCode: nil))
                        return
                    }
                    continuation.resume(returning: code)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: APIError(message: "Could not open Illinois sign-in.", statusCode: nil))
            }
        }
    }
}

@MainActor
final class AppStore: ObservableObject {
    @Published var baseURLText: String
    @Published var currentUser: UserProfile?
    @Published var slots: [TimeSlot] = []
    @Published var matches: [BuddyMatch] = []
    @Published var meetups: [Meetup] = []
    @Published var chats: [ChatSummary] = []
    @Published var nearby: [NearbyPerson] = []
    @Published var presence: WorkoutPresence?
    @Published var blockedUsers: [UserProfile] = []
    @Published var loadingSession = true
    @Published var errorMessage: String?
    @Published var netIDAvailable = false
    @Published var pilotAuthAvailable = false

    private var api: APIClient
    private let netIDBrowser = NetIDBrowser()

    init() {
        let saved = UserDefaults.standard.string(forKey: "serverBaseURL") ?? "http://localhost:8787"
        baseURLText = saved
        api = APIClient(baseURL: URL(string: saved) ?? URL(string: "http://localhost:8787")!)
    }

    func setServerURL(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else {
            throw APIError(message: "Enter a server address such as https://example.org or http://your-mac.local:8787.", statusCode: nil)
        }
        let normalized = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        api.clearSessionCookie()
        baseURLText = normalized
        UserDefaults.standard.set(normalized, forKey: "serverBaseURL")
        api.baseURL = URL(string: normalized)!
        currentUser = nil
        slots = []
        matches = []
        meetups = []
        chats = []
        nearby = []
        presence = nil
        blockedUsers = []
        netIDAvailable = false
        pilotAuthAvailable = false
    }

    func restoreSession() async {
        defer { loadingSession = false }
        await checkNetIDAvailability()
        do {
            let result: UserEnvelope = try await api.request("api/me")
            currentUser = result.user
            try await refreshAll()
        } catch let error as APIError where error.statusCode == 401 {
            currentUser = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func checkNetIDAvailability() async {
        let result: NetIDConfigEnvelope? = try? await api.request("api/auth/netid/config")
        netIDAvailable = result?.enabled == true
        pilotAuthAvailable = result?.pilotAuthEnabled == true
    }

    func loginWithNetID() async throws {
        guard netIDAvailable else {
            throw APIError(message: "Illinois NetID sign-in is not configured on this server yet.", statusCode: nil)
        }
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else {
            throw APIError(message: "Could not start secure sign-in. Please try again.", statusCode: nil)
        }
        let verifier = Self.base64URL(Data(random))
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        var components = URLComponents(url: api.baseURL.appendingPathComponent("api/auth/netid/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "native", value: "1"),
            URLQueryItem(name: "code_challenge", value: challenge)
        ]
        let code = try await netIDBrowser.authorizationCode(from: components.url!)
        let body = try api.encode(NativeNetIDCompletePayload(code: code, verifier: verifier))
        let result: UserEnvelope = try await api.request("api/auth/netid/native/complete", method: "POST", body: body)
        currentUser = result.user
        try await refreshAll()
    }

    func register(name: String, netID: String, password: String) async throws {
        let email = Self.email(for: netID)
        let body = try api.encode(RegisterPayload(name: name, email: email, password: password))
        let result: UserEnvelope = try await api.request("api/auth/register", method: "POST", body: body)
        currentUser = result.user
        try await refreshAll()
    }

    func login(netID: String, password: String) async throws {
        let email = Self.email(for: netID)
        let body = try api.encode(LoginPayload(email: email, password: password))
        let result: UserEnvelope = try await api.request("api/auth/login", method: "POST", body: body)
        currentUser = result.user
        try await refreshAll()
    }

    func logout() async {
        let _: OKEnvelope? = try? await api.request("api/auth/logout", method: "POST")
        api.clearSessionCookie()
        currentUser = nil
        slots = []
        matches = []
        meetups = []
        chats = []
        nearby = []
        presence = nil
        blockedUsers = []
    }

    func refreshAll() async throws {
        try await refreshSchedule()
        try await refreshMatches()
        try await refreshMeetups()
        try await refreshSocial()
    }

    func refreshSchedule() async throws {
        let result: SlotsEnvelope = try await api.request("api/availability")
        slots = result.slots
    }

    func saveSlots(_ value: [TimeSlot]) async throws {
        let body = try api.encode(SlotsPayload(slots: value))
        let result: SlotsEnvelope = try await api.request("api/availability", method: "PUT", body: body)
        slots = result.slots
        try await refreshMatches()
    }

    func previewSchedule(data: Data, filename: String, mimeType: String) async throws -> ImportPreview {
        try await api.uploadPreview(data: data, filename: filename, mimeType: mimeType)
    }

    func updateProfile(_ value: ProfilePayload) async throws {
        let body = try api.encode(value)
        let result: UserEnvelope = try await api.request("api/me", method: "PATCH", body: body)
        currentUser = result.user
        try await refreshMatches()
    }

    func refreshMatches() async throws {
        let result: MatchesEnvelope = try await api.request("api/matches")
        matches = result.matches
    }

    func refreshMeetups() async throws {
        let result: MeetupsEnvelope = try await api.request("api/meetups")
        meetups = result.meetups
    }

    func sendInvite(_ value: MeetupPayload) async throws {
        let body = try api.encode(value)
        let _: MeetupEnvelope = try await api.request("api/meetups", method: "POST", body: body)
        try await refreshMeetups()
    }

    func respondToMeetup(_ id: Int, status: String) async throws {
        let body = try api.encode(MeetupStatusPayload(status: status))
        let _: MeetupEnvelope = try await api.request("api/meetups/\(id)", method: "PATCH", body: body)
        try await refreshMeetups()
    }

    func refreshSocial() async throws {
        let chatsResult: ChatsEnvelope = try await api.request("api/chats")
        let nearbyResult: NearbyEnvelope = try await api.request("api/presence/nearby")
        let presenceResult: PresenceEnvelope = try await api.request("api/presence/me")
        let blocksResult: BlocksEnvelope = try await api.request("api/blocks")
        chats = chatsResult.chats
        nearby = nearbyResult.people
        presence = presenceResult.presence
        blockedUsers = blocksResult.blockedUsers
    }

    func startPresence(activity: String, location: String, durationMinutes: Int) async throws {
        let body = try api.encode(PresencePayload(activity: activity, location: location, durationMinutes: durationMinutes))
        let result: PresenceEnvelope = try await api.request("api/presence", method: "PUT", body: body)
        presence = result.presence
        try await refreshNearby()
    }

    func stopPresence() async throws {
        let _: OKEnvelope = try await api.request("api/presence", method: "DELETE")
        presence = nil
        try await refreshNearby()
    }

    func refreshNearby() async throws {
        let result: NearbyEnvelope = try await api.request("api/presence/nearby")
        nearby = result.people
    }

    func createChat(with userID: Int) async throws -> ChatSummary {
        let body = try api.encode(ChatCreatePayload(toUserId: userID))
        let result: ChatEnvelope = try await api.request("api/chats", method: "POST", body: body)
        try await refreshChats()
        return result.chat
    }

    func refreshChats() async throws {
        let result: ChatsEnvelope = try await api.request("api/chats")
        chats = result.chats
    }

    func messages(for chatID: Int) async throws -> [ChatMessage] {
        let result: MessagesEnvelope = try await api.request("api/chats/\(chatID)/messages")
        return result.messages
    }

    func sendMessage(_ text: String, to chatID: Int) async throws -> ChatMessage {
        let body = try api.encode(MessagePayload(text: text))
        let result: MessageEnvelope = try await api.request("api/chats/\(chatID)/messages", method: "POST", body: body)
        try await refreshChats()
        return result.message
    }

    func blockUser(_ id: Int) async throws {
        let _: BlockEnvelope = try await api.request("api/users/\(id)/block", method: "POST")
        try await refreshMatches()
        try await refreshMeetups()
        try await refreshSocial()
    }

    func unblockUser(_ id: Int) async throws {
        let _: BlockEnvelope = try await api.request("api/users/\(id)/block", method: "DELETE")
        let result: BlocksEnvelope = try await api.request("api/blocks")
        blockedUsers = result.blockedUsers
    }

    func reportUser(_ id: Int, reason: String, details: String) async throws {
        let body = try api.encode(ReportPayload(reason: reason, details: details))
        let _: ReportEnvelope = try await api.request("api/users/\(id)/report", method: "POST", body: body)
    }

    private static func email(for input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.contains("@") ? trimmed : "\(trimmed)@illinois.edu"
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
