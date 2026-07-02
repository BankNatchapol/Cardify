import Foundation

let cardifyAppGroup = "group.com.cardify.mobile.widget"

struct CardifyCandidate: Codable {
    let id: String
    let front: String
    let subtitle1: String
    let subtitle2: String
}

struct CardifySnapshot {
    let deckId: String?
    let deckName: String?
    let candidates: [CardifyCandidate]
}

// Reads the JSON snapshot the RN app writes via ExtensionStorage
// (mobile-app/src/services/widgetSync.ts). `candidates` is stored as raw
// JSON Data by ExtensionStorage's setArray, not a native NSArray, so it must
// be read with `data(forKey:)` + JSONDecoder rather than `array(forKey:)`.
func loadCardifySnapshot () -> CardifySnapshot {
    let defaults = UserDefaults(suiteName: cardifyAppGroup)
    let deckId = defaults?.string(forKey: "deckId")
    let deckName = defaults?.string(forKey: "deckName")
    var candidates: [CardifyCandidate] = []
    if let data = defaults?.data(forKey: "candidates") {
        candidates = (try? JSONDecoder().decode([CardifyCandidate].self, from: data)) ?? []
    }
    return CardifySnapshot(deckId: deckId, deckName: deckName, candidates: candidates)
}
