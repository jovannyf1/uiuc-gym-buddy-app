import Foundation
import Combine

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
    @Published var emailAuthAvailable = false
    @Published var emailAuthConfigurationLoading = true
    @Published var emailAuthConfigurationError: String?
    private var api: APIClient

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
        emailAuthAvailable = false
        emailAuthConfigurationLoading = true
        emailAuthConfigurationError = nil
    }

    func restoreSession() async {
        defer { loadingSession = false }
        await checkEmailAuthAvailability()
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

    func checkEmailAuthAvailability() async {
        emailAuthConfigurationLoading = true
        defer { emailAuthConfigurationLoading = false }
        do {
            let result: EmailAuthConfigEnvelope = try await api.request("api/auth/config")
            emailAuthAvailable = result.emailAuthEnabled
            emailAuthConfigurationError = nil
        } catch {
            emailAuthAvailable = false
            emailAuthConfigurationError = "Could not check email sign-in. Check the server address and your connection."
        }
    }

    func registerEmail(name: String, email: String, password: String) async throws {
        let body = try api.encode(RegisterPayload(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            password: password
        ))
        let result: UserEnvelope = try await api.request("api/auth/email/register", method: "POST", body: body)
        currentUser = result.user
        do {
            try await refreshAll()
        } catch {
            errorMessage = "Your account was created, but some information could not load. Try opening the app again."
        }
    }

    func loginWithEmail(email: String, password: String) async throws {
        let body = try api.encode(LoginPayload(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            password: password
        ))
        let result: UserEnvelope = try await api.request("api/auth/email/login", method: "POST", body: body)
        currentUser = result.user
        try await refreshAll()
    }

    func resendEmailVerification(email: String) async throws -> String {
        let body = try api.encode(EmailResendPayload(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        ))
        let result: EmailAcknowledgmentEnvelope = try await api.request("api/auth/email/resend", method: "POST", body: body)
        return result.message ?? "If this account needs verification, a link is on its way. Check your inbox and spam folder."
    }

    func sendEmailVerification() async throws -> String {
        let result: EmailAcknowledgmentEnvelope = try await api.request(
            "api/auth/email/verify/send", method: "POST", body: Data("{}".utf8))
        return result.message ?? "Verification email sent. Check your inbox and spam folder."
    }

    func refreshAccountStatus() async {
        guard currentUser != nil else { return }
        guard let result: UserEnvelope = try? await api.request("api/me") else { return }
        currentUser = result.user
    }

    func requestEmailPasswordReset(email: String) async throws -> String {
        let body = try api.encode(EmailResendPayload(
            email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        ))
        let result: EmailAcknowledgmentEnvelope = try await api.request("api/auth/email/reset/request", method: "POST", body: body)
        return result.message ?? "If an account exists for this email, a password-reset link is on its way. Check your inbox and spam folder."
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

}
