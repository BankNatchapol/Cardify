import WidgetKit

struct CardifyEntry: TimelineEntry {
    let date: Date
    let deckId: String?
    let deckName: String
    let cardId: String?
    let front: String
    let subtitle1: String
    let subtitle2: String
}

struct CardifyProvider: TimelineProvider {
    func placeholder (in context: Context) -> CardifyEntry {
        CardifyEntry(date: Date(), deckId: nil, deckName: "Cardify", cardId: nil, front: "爱", subtitle1: "ài", subtitle2: "love")
    }

    func getSnapshot (in context: Context, completion: @escaping (CardifyEntry) -> Void) {
        let snapshot = loadCardifySnapshot()
        completion(entry(for: Date(), from: snapshot))
    }

    func getTimeline (in context: Context, completion: @escaping (Timeline<CardifyEntry>) -> Void) {
        let snapshot = loadCardifySnapshot()
        // Bucketed to the top of the current hour: getTimeline can be called
        // multiple times within the same hour (e.g. the RN app calls
        // reloadWidget() after every rated card, to refresh the *pool*) —
        // bucketing means the card showing *right now* only changes at the
        // top of each hour, not every time the pool happens to refresh.
        let hourStart = Calendar.current.dateInterval(of: .hour, for: Date())?.start ?? Date()

        var entries: [CardifyEntry] = []
        for hourOffset in 0..<24 {
            let entryDate = Calendar.current.date(byAdding: .hour, value: hourOffset, to: hourStart) ?? hourStart
            entries.append(entry(for: entryDate, from: snapshot))
        }

        // Safety-net reload — real freshness comes from the RN app calling
        // ExtensionStorage.reloadWidget() whenever card state actually changes.
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 24, to: hourStart) ?? hourStart
        completion(Timeline(entries: entries, policy: .after(nextRefresh)))
    }

    private func entry (for date: Date, from snapshot: CardifySnapshot) -> CardifyEntry {
        let card = candidateForHour(date, in: snapshot.candidates)
        return CardifyEntry(
            date: date,
            deckId: snapshot.deckId,
            deckName: snapshot.deckName ?? "Cardify",
            cardId: card?.id,
            front: card?.front ?? "—",
            subtitle1: card?.subtitle1 ?? "",
            subtitle2: card?.subtitle2 ?? ""
        )
    }

    // Deterministic pick based on (candidate id, hour) — NOT array position.
    // The candidates array is rebuilt from a DB query ordered by lapses/due_at
    // after every rated card, and SQLite doesn't guarantee stable ordering
    // for ties (common early on, when many cards share lapses = 0) — so an
    // index-based pick could point at a different card even within the same
    // hour, purely because the array got reordered. Scoring each candidate
    // by its own stable id instead means a given card keeps winning its hour
    // as long as it stays in the pool, regardless of how the array around it
    // gets reordered or resampled.
    private func candidateForHour (_ date: Date, in candidates: [CardifyCandidate]) -> CardifyCandidate? {
        guard !candidates.isEmpty else { return nil }
        if candidates.count == 1 { return candidates.first }
        let hoursSinceEpoch = UInt64(bitPattern: Int64(date.timeIntervalSince1970 / 3600))
        return candidates.min { lhs, rhs in
            fnv1aHash(lhs.id, seed: hoursSinceEpoch) < fnv1aHash(rhs.id, seed: hoursSinceEpoch)
        }
    }

    // Swift's built-in Hasher/.hashValue is randomized per process launch
    // (DoS-resistance) — not safe here, since the widget extension process
    // can be relaunched by the OS mid-hour, which would silently change the
    // pick. FNV-1a is a plain deterministic string hash: same input always
    // produces the same output, across any process/session.
    private func fnv1aHash (_ string: String, seed: UInt64) -> UInt64 {
        var hash: UInt64 = 14695981039346656037 ^ seed
        for byte in string.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1099511628211
        }
        return hash
    }
}
