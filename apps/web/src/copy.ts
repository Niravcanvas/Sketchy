/**
 * Product copy — single source of truth for every user-facing string.
 *
 * arch/conventions.md §4 (i18n posture): this roadmap doesn't ship i18n yet,
 * but ALL strings route through this module, keyed per the §-labels used in
 * arch/copy.md, so extraction into locale files later is mechanical. No
 * string literals in JSX — import from `copy` instead (enforced by the
 * `react/jsx-no-literals` eslint rule).
 *
 * Text below is copied verbatim from arch/copy.md. Do not rewrite in-code;
 * edit arch/copy.md first, then mirror the change here in the same PR.
 */
export const copy = {
  /** arch/copy.md §1 — Brand */
  brand: {
    name: 'Sketchy',
    taglinePrimary: "Everyone's a little sketchy.",
    /** One-line description (store/SEO) — also used for the <html> metadata description. */
    oneLineDescription:
      'Sketchy is a social deduction party game for 3–20 players: everyone gets a secret word — except the players who got a slightly different one, and the one who got nothing at all. Describe, accuse, vote, and try not to look sketchy.',
  },
  /** arch/copy.md §2 — Home screen */
  home: {
    header: {
      name: 'Sketchy',
      tagline: "Everyone's a little sketchy.",
    },
    primaryActions: {
      playOnThisPhone: 'Play on this phone',
      createARoom: 'Create a room',
      joinARoom: 'Join a room',
    },
    secondaryActions: {
      howToPlay: 'How to play',
      wordPacks: 'Word packs',
      myScrapbook: 'My scrapbook',
    },
    namePrompt: {
      question: 'What should we call you?',
      placeholder: 'Your name…',
      helper: 'No account needed. You can change this anytime.',
      submit: "Let's go",
    },
    footer: 'Best with 6–12 players and at least one dramatic friend.',
  },
  /**
   * arch/copy.md §3.1 — Base role cards (shown on the deal, press-and-hold to
   * peek). Special roles are §3.2 below. The status-strip "Waiting for {n}
   * players to peek…" line lives in `dealChrome.waitingForPeek` (online rooms
   * only).
   */
  roles: {
    civilian: {
      cardTitle: 'CIVILIAN',
      wordLine: 'Your secret word:',
      flavor: "Most players got this same word. Someone didn't.",
      goalLine: "Describe it. Watch. Vote out everyone who doesn't quite fit.",
      reminderChip: "Don't say your word out loud. Obviously.",
    },
    undercover: {
      cardTitle: 'UNDERCOVER',
      wordLine: 'Your secret word:',
      flavor: "Careful — your word is almost everyone else's word. Almost.",
      goalLine: 'Blend in. Sound confident. Survive the votes.',
      reminderChip: "You don't know who's with you. Neither do they.",
    },
    mrWhite: {
      cardTitle: 'MISTER WHITE',
      wordLine: 'Your secret word:',
      /** Stands in for `{word}` on Mister White's card — he doesn't get one. */
      blankLine: '— nothing. You get nothing. —',
      flavor: "Everyone else is describing a word. You're describing pure vibes.",
      goalLine: 'Bluff your way through. If they catch you, guess their word to steal the win.',
      reminderChip: 'Listen hard. Every clue is a hint.',
    },
    /** Deal-screen chrome shared by all three role cards above. */
    dealChrome: {
      pressAndHold: 'Press and hold to peek',
      onRelease: 'Hidden. Very sneaky.',
      confirm: 'Got it',
      /** arch/copy.md §3.1 — online status-strip line during `dealing`. */
      waitingForPeek: (n: number) => `Waiting for ${n} players to peek…`,
    },
    /**
     * arch/copy.md §3.2 — Special roles. Settings toggle label + description + deal-card
     * extra line per role, verbatim: Judge/Ghost/Jester/Lovebirds/Grudge/Mirror/Rivals/Mime.
     */
    special: {
      sectionHeader: 'Spice (optional roles)',
      sectionHelper: 'All optional. Add one or two once your table knows the basics.',
      /** Min-player gating reason (minor UI copy, not itself in copy.md — only Lovebirds/
       * Grudge/Rivals trigger it; Judge/Ghost/Jester/Mirror/Mime never do — see
       * packages/engine/ROLES.md / constants.ts `SPECIAL_ROLE_MIN_PLAYERS`). */
      needsMorePlayers: (n: number) => `Needs ${n}+ players.`,
      /** Budget guardrail: total special roles must not exceed floor(players/2) — shown
       * on a toggle the host can't turn on right now because the table's already spicy
       * enough. Not itself in copy.md §3.2; follows the section helper's own tone
       * ("Add one or two once your table knows the basics"). */
      tooSpicy: "That's plenty for this table size. Turn one off first.",
      judge: {
        toggleLabel: 'The Judge',
        description:
          "When a vote ties, the Judge decides who's out — even after they've been eliminated.",
        /** Deal-card extra line for the holder AND (verbatim reuse, copy.md §6 "Judge
         * decision phase") the headline of the Judge's own decision screen. */
        dealCardLine: "Ties are yours. Rule wisely, or don't.",
        /** copy.md §6 "Judge decision phase" — everyone else's line while the Judge decides. */
        waitingForDecision: 'The Judge is deciding…',
        /** copy.md §6 — announcement toast, fires every time a tie routes to the Judge. */
        tieAnnouncement: "It's a tie. The Judge gets the final say this time.",
      },
      ghost: {
        toggleLabel: 'The Ghost',
        description:
          'Eliminated players keep chatting and voting from beyond. Death is not an excuse.',
        /** copy.md §8 — the elimination banner variant when Ghost is enabled (replaces
         * `presence.eliminatedSelf`). */
        eliminatedBanner: "You're a Ghost. You still vote. Haunt responsibly.",
      },
      jester: {
        toggleLabel: 'The Jester',
        description:
          'If the Jester is the very first player voted out, they score +4 points for the drama.',
        dealCardLine: 'Getting caught first would be… kind of great for you?',
      },
      lovebirds: {
        toggleLabel: 'The Lovebirds',
        description: "Two players are secretly linked. If one goes down, so does the other.",
        /** `{name}` = the partner's name, resolved client-side from `you.lovebirdsPartnerId`
         * against the public roster (data-model.md "Phase 13 engine extension"). */
        dealCardLine: (name: string) =>
          `You're a Lovebird. Your fate is tied to ${name}. Protect them — quietly.`,
        /** Reveal-card note shown whenever the just-revealed player holds Lovebirds, on
         * either half of the chained pair, following §12's tone rules; not itself in
         * copy.md §3.2. Deliberately name-agnostic — the reveal card itself already names
         * whoever's currently showing. */
        cascadeNote: 'Lovebirds — where one goes, the other follows.',
      },
      grudge: {
        toggleLabel: 'The Grudge',
        description: 'When the Grudge is eliminated, they drag one player down with them.',
        /** Deal-card extra line for the holder AND (verbatim reuse, same pattern as the
         * Judge above) the headline of the Grudge's own drag-down decision screen. */
        dealCardLine: "If you go down, someone's coming with you.",
        /** Everyone else's line while the Grudge decides, mirrors the Judge's
         * `waitingForDecision`. */
        waitingForDecision: "The Grudge is deciding who's coming with them…",
        /** Announcement toast, fires every time the grudge-decision phase opens. */
        announcement: (name: string) => `${name} isn't going alone. Choosing now…`,
        /** Shown when the drag-down decision resolves to nobody (timeout or host escape
         * hatch; copy.md §3.2 "defaults to nobody on expiry"). */
        draggedNobody: 'Decided against it. Nobody else goes down.',
      },
      mirror: {
        toggleLabel: 'The Mirror',
        description:
          'The first time the table votes the Mirror out, the votes bounce back at the voters. Once.',
        dealCardLine: 'The first mob that comes for you will regret it.',
        /** The reveal screen's distinct "bounce" beat. Deliberately names nobody: the
         * Mirror's identity stays secret even after their power fires
         * (`GameState.mirrorBounced` carries no player id either). */
        bounceHeadline: 'The vote bounced back.',
      },
      rivals: {
        toggleLabel: 'The Rivals',
        description:
          'Two players are secretly feuding: first one eliminated loses 2 points, the survivor gains 2.',
        /** `{name}` = the rival's name, resolved client-side from `you.rivalId`. */
        dealCardLine: (name: string) => `You have a rival: ${name}. Outlast them.`,
      },
      mime: {
        toggleLabel: 'The Mime',
        description:
          'Each round one random player must give their clue in gestures only. In-person rooms only.',
        /** copy.md §3.2 — public round toast, fires whenever `mimeId` changes. */
        roundToast: (name: string) => `${name} is the Mime this round — gestures only, not a word!`,
        /** Clue-board note for a mimed clue. */
        cluedNote: ' (mimed)',
      },
    },
  },
  /** arch/copy.md §4 — Rooms & invites: lobby avatar picker (`<AvatarPicker>`) */
  avatar: {
    picker: {
      heading: 'Your doodle',
      helper: 'This is how the table sees you.',
      rows: {
        head: 'Head',
        face: 'Face',
        accessory: 'Extras',
      },
      /** Icon-only prev/next buttons per row — aria-label only, no visible text. */
      previous: (part: string) => `Previous ${part}`,
      next: (part: string) => `Next ${part}`,
      /** Screen-reader names for the 5 ink swatch buttons — the swatches themselves are the
       * palette tokens (conventions.md §2), not separate copy the player reads. */
      inkColorNames: {
        civilian: 'Civilian blue',
        undercover: 'Undercover red',
        mrwhite: 'Mister White violet',
        success: 'Success green',
        highlight: 'Highlight yellow',
      },
    },
  },
  /**
   * arch/copy.md §4 — Rooms & invites (online lobby). The lobby header's "Room
   * **{CODE}**" line is split into a small label + the code itself (rendered huge/bold by
   * `room-code-hero.tsx` — the `**...**` in copy.md is a visual instruction, not literal
   * asterisks, EXCEPT inside `inviteMessage` below, where the pasted-into-Discord blurb
   * relies on Discord's own markdown renderer, so those asterisks are kept literal.
   */
  rooms: {
    hero: {
      label: 'Room',
      tagline: 'Tell your friends the code, or just send the link.',
    },
    actions: {
      copyCode: 'Copy code',
      copyLink: 'Copy link',
      copyInvite: 'Copy invite message',
      /** Transient confirmation after a copy action (icon swap + aria-live) — not itself in
       * copy.md §4, but a small, tone-consistent addition needed for the a11y announcement
       * (conventions.md §4). */
      copied: 'Copied.',
    },
    /** The paste-into-Discord blurb (copy.md §4) — preserves the source's line breaks
     * verbatim via `\n` and keeps the `**bold**` markers literal (Discord markdown). */
    inviteMessage: (code: string, joinUrl: string) =>
      `Get in here — we're playing **Sketchy**.\nRoom code: **${code}**\n${joinUrl}\n(3 minutes to learn. Nobody trusts anybody. It's great.)`,
    join: {
      title: 'Join a room',
      placeholder: 'ROOM CODE',
      submit: 'Knock knock',
    },
    ready: {
      ready: "I'm ready",
      notReady: 'Hang on…',
      /** Host force-start confirm dialog (copy.md §4 ready flow). */
      forceStartConfirm: "Not everyone's ready. Start anyway?",
      start: 'Start',
      wait: 'Wait',
    },
    emptyState: "It's quiet in here… too quiet. Invite some suspects.",
    /** Timers section (copy.md §4). */
    timers: {
      header: 'The clock',
      helper: 'Untimed is best on a voice call.',
      presetUntimed: "Untimed — we're on a call",
      presetStandard: 'Standard',
      presetSpeedy: 'Speedy',
    },
    /** Host kick confirmation (not previously scripted anywhere in
     * copy.md; the "knock again" callback deliberately echoes the join button's copy). */
    kick: {
      title: 'Kick player?',
      description: (name: string) => `Kick ${name}? They can knock again anytime.`,
      confirm: 'Kick them',
      cancel: 'Keep them',
    },
    /** Chat drawer (game-design.md §3.4) — copy.md has no scripted lines for chat's own
     * chrome (only §8's presence toasts, mirrored separately above), so this is a minimal,
     * tone-neutral addition rather than a mirrored line. */
    chat: {
      label: 'Message',
      placeholder: 'Say something…',
      send: 'Send',
    },
    /** arch/copy.md §4 "Voice (phase 15, new)" — the status-strip pill (lobby AND in-game,
     * game-design.md §10) and everything that hangs off it. `pill.idle` is ALSO the exact
     * replacement text for the struck-through call hint above. */
    voice: {
      pill: {
        idle: 'Join voice',
        connecting: 'Connecting…',
        connected: 'Voice on',
        unavailable: 'Voice unavailable',
        denied: 'Mic blocked',
      },
      micDenied:
        "Mic's blocked. The game doesn't need it — fix it in your browser's site settings if you change your mind, or just keep playing.",
      unavailableHint:
        "Voice is down for a moment. Nothing about the game depends on it — we'll quietly reconnect when it's back.",
      iosTooltip:
        'Voice works best with this tab open and awake — iOS pauses your mic the second you switch apps or lock the screen.',
      mute: 'Mute',
      unmute: 'Unmute',
      leave: 'Leave voice',
      joinedToast: (name: string) => `${name} joined voice.`,
      leftToast: (name: string) => `${name} left voice.`,
    },
  },
  /** arch/copy.md §5 — Pass-and-play */
  pnp: {
    setup: {
      title: "Who's playing?",
      addPlayerPlaceholder: 'Add a name…',
      playerCountWarning: 'Playable with 3, properly fun with 6+.',
      /** Shown when `GET /packs` fails and we fall back to the bundled starter pack. */
      offlinePacks: 'Offline — the built-in starter pack is on the table.',
    },
    packPicker: {
      header: 'The words',
      helper: "Pick a pack or three. We'll shuffle.",
    },
    difficulty: {
      easy: 'Easy',
      medium: 'Medium',
      hard: 'Hard',
    },
    typedClues: {
      toggleLabel: 'Write clues on the board',
      toggleHelper: 'Off: clues are spoken out loud. On: each player also pins a one-word note.',
    },
    steppers: {
      header: 'The cast',
      helper: (n: number) => `We've suggested a mix for ${n} players. Meddle at your own risk.`,
      /** Inline validation error when civilians wouldn't outnumber the sketchy side. */
      roleMathError: 'Too many impostors — civilians must outnumber the sketchy side.',
    },
    passInterstitial: {
      prompt: (name: string) => `Pass the phone to ${name}`,
      confirm: "That's me",
      smallPrint: 'Everyone else, look away. Yes, you.',
    },
    /** Accessibility alternative to press-and-hold (conventions.md §4). */
    peekA11y: {
      show: 'Show my card',
      hide: 'Hide my card',
    },
    afterPeek: {
      passItOn: 'Pass it on',
      lastPlayer: "Everyone's in. Start round 1",
    },
    clueTracker: {
      line: (name: string) => `${name}, describe your word out loud. One word or a short phrase.`,
      next: 'Next player',
    },
    voteHandoff: (name: string) => `Pass to ${name} to vote — no peeking at the last ballot.`,
    openVote: {
      toggleLabel: 'Open voting',
      toggleHelper: 'One screen, the table points, one person records. Less passing, more arguing.',
      instruction: 'Record each vote as the table calls it out.',
    },
    resume: {
      prompt: 'Pick up where you left off? Your last game is still on the table.',
      resume: 'Resume',
      startFresh: 'Start fresh',
    },
  },
  /**
   * arch/copy.md §11 — Button & label glossary. Only the entries the pass-and-play
   * screens actually need are mirrored here (not the whole glossary) — add more as
   * new flows need them.
   */
  glossary: {
    /** Host CTA to leave the setup screen and deal the first round. */
    startGame: 'Start game',
    /** Destructive-action word — used here as the remove-name chip's aria-label. */
    delete: 'Delete',
    /** arch/copy.md §11 — host's once-per-phase timer extension chip. */
    extendTimer: '+60s',
    /** arch/copy.md §11 — generic dismiss/cancel action, reused by confirm dialogs
     * (skip-turn, force-start) that don't have their own contextual "keep it"-style
     * cancel line the way the kick dialog does. */
    cancel: 'Cancel',
    /** arch/copy.md §11 — already listed in the glossary paragraph; mirrored here now that
     * the pair editor is the first feature to actually use it (row/bulk-paste
     * commit action). */
    save: 'Save',
  },
  /** arch/copy.md §6 — In-game phases (subset reachable from pass-and-play so far). */
  phases: {
    status: {
      roundClues: (n: number) => `Round ${n} — Clues`,
      discussion: 'Discussion',
      theVote: 'The Vote',
      tiebreaker: 'Tiebreaker',
      theReveal: 'The Reveal',
    },
    clue: {
      yourTurn: 'Your turn. One word or a short phrase about your secret word.',
      placeholder: 'Your clue…',
      button: 'Pin it to the board',
      /** Crumpled note shown for a skipped turn. */
      skipped: 'skipped',
      /** Non-turn-holders' line during `clue`/`tiebreak_clue` (copy.md §6). */
      thinking: (name: string) => `${name} is thinking…`,
      /** Host's stalled-turn escape hatch (copy.md §6/§11). */
      skipButton: 'Skip their turn',
      skipConfirm: (name: string) => `Skip ${name}? They can still rejoin and play next round.`,
    },
    discussion: {
      banner: 'Talk it out. Who sounded a little… off?',
      callTheVote: 'Call the vote',
    },
    voting: {
      banner: 'Vote to eliminate. Choose carefully — the majority rules.',
      selfVoteTooltip: "You can't vote for yourself. Bold, though.",
      ballotCast: 'Ballot in. You can still change it until the vote closes.',
      progress: (k: number, n: number) => `${k}/${n} have voted`,
      lockItIn: 'Lock it in',
    },
    tiebreak: (names: string) =>
      `It's a tie between ${names}. Each of them gives one more clue — then we vote again. No pressure.`,
    secondTie:
      "The table can't decide. Nobody goes home this round — but nobody's off the hook either.",
    allAbstain: 'Nobody voted?! Fine. Everyone survives. For now.',
  },
  /** arch/copy.md §7 — Reveals, wins & scoring */
  reveal: {
    buildup: {
      tableHasSpoken: 'The table has spoken.',
      playerIsOut: (name: string) => `${name}, you're out.`,
    },
    roleReveal: {
      civilian: (name: string) =>
        `${name} was… a Civilian. Well. That's awkward for everyone who pointed.`,
      undercover: (name: string) => `${name} was… UNDERCOVER. Got one!`,
      misterWhite: (name: string) => `${name} was… MISTER WHITE. But wait — they get one guess…`,
    },
    mrWhiteGuess: {
      yours: "One shot. What's the Civilians' word?",
      placeholder: 'Say the word…',
      button: 'Steal the win',
      othersWaiting: 'Mister White is guessing… hold your breath.',
    },
    guessWrong: (guess: string) =>
      `'${guess}' — nope. Not even close. (Okay, maybe close.) They're out for real.`,
    guessRight: (word: string) =>
      `MISTER WHITE STEALS IT. The word was '${word}' and they plucked it out of thin air. +6 points.`,
    /** Headline + subline + points chip; join with a space to get the copy.md sentence verbatim. */
    winScreens: {
      civilians: {
        headline: 'CASE CLOSED.',
        subline: 'The Civilians sniffed out every impostor.',
        points: '+2 points each.',
      },
      undercover: {
        headline: 'THEY NEVER SAW IT COMING.',
        subline: 'The Undercover walked among you the whole time.',
        points: '+10 points.',
      },
      infiltrators: {
        headline: 'FULL INFILTRATION.',
        subline: "Undercover and Mister White split the table's trust — and the win.",
        points: '+10 / +6 points.',
      },
    },
    /** Eliminated-player strip tag (design-party-pop.md §11): the `bg-undercover` "OUT" row
     * carries an ink chip reading the just-revealed role, e.g. "OUT · UNDERCOVER". */
    outTag: (roleTitle: string) => `OUT · ${roleTitle}`,
    fullReveal: {
      header: 'The whole truth:',
      pairLine: (word: string, word2: string) => `Civilians had ${word}, Undercover had ${word2}.`,
    },
    scoreboard: {
      title: "Tonight's scoreboard",
      lifetimeChip: (points: number) => `scrapbook total: ${points}`,
      /** The this-game points bump popped onto a player's session total (design-party-pop.md
       * §11 "score bumps") — the 2/6/10 delta beside their running score. */
      delta: (points: number) => `+${points}`,
      /** A NEGATIVE bump (the Rivals first-out -2 — design-party-pop.md §11's
       * "score bumps" only anticipated positive deltas until Rivals; `points` is already
       * negative, so no extra sign-flipping is needed here). */
      deltaNegative: (points: number) => `${points}`,
    },
    /** Jester first-out bonus line — shown on the win screen only when the very
     * first player eliminated this game held the Jester (copy.md §7). */
    jesterBonus: (name: string) => `${name} was the Jester. Getting caught first paid off — +4 points.`,
    /** Rivals scoring line items (not itself in copy.md §7, follows its "scoreboard line
     * items" framing from §3.2's Rivals description). Shown on the win screen only when
     * the Rivals role produced a scoring swing (never when both survived or both fell
     * together — data-model.md "Phase 13 engine extension"). */
    rivalsFirstOut: (name: string) => `${name} lost the feud — first eliminated, -2 points.`,
    rivalsSurvivor: (name: string) => `${name} outlasted their rival — +2 points.`,
    endCTAs: {
      rematch: 'Rematch — same crew, new word',
      backToLobby: 'Back to lobby',
      waitingForHost: (host: string) => `Waiting for ${host} to deal the next one…`,
      leaveRoom: 'Leave room',
    },
  },
  /**
   * arch/copy.md §8 — Presence & system events (toasts / banners). `kickedSelf` /
   * `kickedOthers` split the single §8 "kicked" entry, which reads differently depending on
   * whether the viewer is the player who got kicked (`room-store.ts`'s `roomEventText`
   * disambiguates using the kicked `playerId` vs. the viewer's own).
   */
  presence: {
    playerJoined: (name: string) => `${name} slid into the room.`,
    playerLeft: (name: string) => `${name} left. Suspicious? Probably fine.`,
    playerDisconnected: (name: string) => `${name} lost connection — holding their seat…`,
    playerReconnected: (name: string) => `${name} is back. Act natural.`,
    hostChanged: (name: string) => `${name} holds the pencil now (new host).`,
    kickedSelf: 'The host removed you from the room. Rooms are like that sometimes.',
    kickedOthers: (name: string) => `${name} was shown the door.`,
    timerExtended: 'The host added a minute. Use it wisely.',
    reconnectingSelf: 'Reconnecting… your seat is safe.',
    /** arch/copy.md §8 — banner shown to a player once they've been eliminated: they keep
     * watching (clue board, chat, reveals) but lose inputs (game-design.md §9). A
     * Ghost-role variant exists separately — see `special.ghost.eliminatedBanner`. */
    eliminatedSelf: "You're out — but stick around. Heckling from the afterlife is encouraged.",
    /** Player-strip microtext for a disconnected player's card (game-design.md §3.2) — the
     * same copy.md §8 line as `playerDisconnected`, minus the name (already shown on the
     * card itself right above it). */
    disconnectedCardMicrotext: 'lost connection — holding their seat…',
    /** PINNED — banner shown on the socket that just got superseded by a newer
     * connection for the same player (api-contract.md §2 `session:superseded`). */
    sessionSuperseded: 'You opened this room somewhere else — this tab is paused.',
    /** arch/copy.md §8 rejoin prompt (site revisit) — shown on any site entry
     * when localStorage remembers an in-progress room (game-design.md §8). */
    rejoinPrompt: (code: string) => `You have a game in progress in room ${code}.`,
    rejoinCta: 'Rejoin',
    abandonCta: 'Abandon',
    /** Player-card host action (game-design.md §8 manual hand-back). */
    makeHost: 'Make host',
    makeHostConfirm: (name: string) => `Hand the pencil to ${name}? You'll be a regular player.`,
  },
  /**
   * arch/copy.md §9 — Errors & empty states, keyed by `ErrorCode`
   * (`@sketchy/shared/contract/errors`). Only the codes reachable from
   * flows actually wired up are mirrored here; add more as new flows
   * need them.
   */
  errors: {
    profanity: "Let's keep it printable. Try different words.",
    rateLimited: 'Easy there. Give it a few seconds and try again.',
    validation: "That didn't look right — check it and try again.",
    emptyPool: 'No words left in those packs, or no packs selected. Pick some words!',
    unauthorized: "Your session went stale. Refresh and you'll be back in.",
    /** copy.md §9 `not_found` row — already documented, first mirrored here for the
     * `/packs/import` bad-share-code case (every earlier `not_found` use had a
     * more specific mapped line, e.g. `roomNotFound`). */
    notFound: "We couldn't find that. It may have been deleted — or never existed. Spooky.",
    /** network offline (client-side) — not an `ErrorCode`, a raw `fetch` failure. */
    networkOffline:
      "You're offline. Pass-and-play still works — online rooms will reconnect when you're back.",
    /** generic 500 — also the fallback for any `ErrorCode` without a more specific line above. */
    generic500: "Something broke on our end. It's not you, it's us. Try again in a moment.",
    roomFull: (max: number) =>
      `That room is packed (${max} players). Someone has to leave before you can squeeze in.`,
    nameTakenInRoom: (name: string) =>
      `Someone in this room already claimed that name. Pick a variant — ${name}² has a ring to it.`,
    notHost: 'Only the host can do that. Flattering that you tried.',
    notYourTurn: 'Not your turn yet — the suspense is the point.',
    wrongPhase: 'Too late (or too early) for that. The game moved on.',
    alreadyVoted: "Your ballot's already in. You can change it until the vote closes.",
    clueRepeated: 'Someone already used that clue this game. Original thoughts only.',
    clueIsSecretWord: "That's… the word. You can't just say the word.",
    roomNotFound:
      'No room with that code. Check it with whoever invited you — codes expire after a day.',
    roomInProgress:
      "They've already started this game. You can wait for the next round — ask them to rematch you in.",
    /** Same §8 line as `presence.kickedSelf` — copy.md §9 just points back at §8 for this code. */
    kicked: 'The host removed you from the room. Rooms are like that sometimes.',
    packForbidden: "You don't have access to that word pack.",
    pairLimit: (max: number) =>
      `That's the limit for this pack (${max} pairs). Quality over quantity.`,
    /** copy.md §9 — the sibling packs-per-player cap, same `pair_limit`
     * `ErrorCode` on the wire as `pairLimit` above but a distinct message (the client picks
     * by context: which action was being attempted, same pattern as `kickedSelf`/`kickedOthers`
     * disambiguating one code by viewer instead of by action). */
    packLimit: (max: number) =>
      `That's the limit for packs on your account (${max} packs). Retire one to make room.`,
    roomExpired: 'This room has expired. Start a fresh one — it takes five seconds.',
    /** copy.md §9 — the `VOICE_ENABLED` kill-switch's clean error. */
    voiceDisabled: 'Voice chat is turned off right now — the game itself is unaffected.',
    /** copy.md §9 — `account_required`: a guest hit a public-matchmaking
     * surface; `suspended`: a moderation-suspended player's sanitized rejection. */
    accountRequired:
      'Playing with strangers needs a quick account. Link your email — private rooms never need it.',
    suspended:
      'Your access to Sketchy has been suspended. If you think this is a mistake, get in touch.',
  },
  /** arch/copy.md §9 "404 (page not found, phase 14, new)" — the Next.js `not-found.tsx`
   * route, not itself an `ErrorCode` (no request ever reaches the API for a route that
   * doesn't exist client-side). */
  notFound: {
    headline: "This page doesn't exist. Suspicious.",
    body: "Maybe it moved. Maybe you're the impostor here.",
    cta: 'Back to home',
  },
  /** arch/copy.md §10 — How to play: the four onboarding cards (`/how-to-play`),
   * the lobby cheat-sheet card, and the how-to-play route's own nav chrome. */
  howToPlay: {
    cheatSheet: 'Clue → Argue → Vote → Reveal. Repeat until somebody wins.',
    /** The four `/how-to-play` cards, in order — verbatim from copy.md §10. */
    cards: [
      {
        headline: 'Everyone gets a word. Almost.',
        body: "Civilians share one secret word. Undercovers get a near-miss copy. Mister White gets absolutely nothing and has to fake it.",
      },
      {
        headline: 'Describe it — carefully.',
        body: 'One clue each, out loud, every round. Too obvious helps the fakers. Too vague makes YOU look fake.',
      },
      {
        headline: 'Vote somebody out.',
        body: "Argue, accuse, then vote. The eliminated player's role is revealed. Caught Mister White? They get one desperate guess at the word.",
      },
      {
        headline: 'Last side standing wins.',
        body: 'Civilians win by clearing out the impostors. Impostors win by surviving to the end. Points: Civilians +2, Mister White +6, Undercover +10.',
      },
    ],
    /** `/how-to-play`'s own nav chrome (copy.md "Onboarding chrome", phase 14, new). The
     * final card's forward action reuses `roles.dealChrome.confirm` ("Got it") instead of
     * `next` — wired at the call site, not duplicated here. */
    nav: {
      skip: 'Skip',
      back: 'Back',
      next: 'Next',
      /** Screen-reader-only progress announcement on every card change. */
      progress: (n: number, total: number) => `Card ${n} of ${total}`,
    },
  },
  /** arch/copy.md "Onboarding chrome" §10 subsection — first-game contextual hints (phase
   * 14, new): one-time dismissible callouts above the peek card, clue input, and vote grid.
   * Dismissal is per-device (localStorage), same posture as `lib/active-room.ts`. */
  hints: {
    dismissAria: 'Dismiss hint',
    peekCard: {
      headline: 'Peek — carefully.',
      body: "Press and hold to see your word. Let go and it's gone again.",
    },
    clueInput: {
      headline: 'One clue, no leaks.',
      body: 'A word or a short phrase about your secret word. Never the word itself.',
    },
    voteGrid: {
      headline: 'Point the finger.',
      body: 'Tap a suspect, then lock it in. You can change your mind until the vote closes.',
    },
  },
  /** Site-wide data-use disclosure (Phase-9-prep, `data-notice-banner.tsx`) — not cookie
   * consent, since Sketchy sets no cookies of its own (the optional Sign in with Google is the
   * only thing that might, and only if you use it); a plain disclosure of local-storage +
   * optional crash-reporting use, matching the privacy page's own cookies section. */
  dataNotice: {
    body: 'Sketchy stores your login token and game preferences in this browser’s local storage and sets no cookies of its own — no ad trackers, either. If you use Sign in with Google, Google may set its own cookies as part of that flow. If crash reporting is enabled, it gets anonymized technical error data only.',
    learnMore: 'Read the privacy page',
    dismiss: 'Got it',
  },
  /** arch/copy.md "Sound" §10 subsection (phase 14, new) — the persistent mute toggle's
   * label, which doubles as its `aria-label`. */
  sound: {
    muteLabel: 'Mute',
    unmuteLabel: 'Unmute',
  },
  /** arch/copy.md §14 — Profile & scrapbook (phase 10). `/profile` page: identity card,
   * headline totals, per-role win-rate bars, points-over-time sparkline, history list with
   * expandable round-by-round summaries, and the guest-identity footer caveat. */
  profile: {
    screenTitle: 'My scrapbook',
    identity: {
      editAria: 'Edit your name and doodle',
      /** Not in the shared §11 glossary (that only has `Cancel`/`Delete`) — scoped here
       * rather than added to `glossary` to avoid touching that shared block. */
      save: 'Save',
      cancel: 'Cancel',
    },
    headline: {
      scrapbookTotal: 'Scrapbook total',
      gamesPlayed: 'Games played',
      gamesWon: 'Games won',
    },
    byRole: {
      header: 'By role',
      /** "{won}/{played} won" — e.g. "3/5 won". */
      statLine: (won: number, played: number) => `${won}/${played} won`,
      neverPlayed: "Haven't played this one yet.",
    },
    sparkline: {
      header: 'Points over time',
      helper: (n: number) => `Your last ${n} games.`,
      tooFewGames: "Play a couple more and this'll start to look like something.",
    },
    history: {
      header: 'Past games',
      /** Same line as the §9 history empty state — mirrored here so the profile page can
       * import it without reaching into `errors`. */
      emptyState: 'No games in the scrapbook yet. Go get suspected of something.',
      modeLabels: {
        pass_play: 'Pass & play',
        online_private: 'Private room',
        online_public: 'Public room',
      },
      /** Shown in place of the winner-faction line for a game with `winnerFaction: null`
       * (data-model.md §1 "NULL = abandoned before finishing"). */
      abandoned: 'Abandoned — nobody finished this one.',
      loadMore: 'Load more',
      roundByRoundToggle: 'Round-by-round',
      roundHeading: (n: number) => `Round ${n}`,
      cluesLabel: 'Clues',
      votesLabel: 'Votes',
      noElimination: 'Nobody went home this round.',
      /** Aggregate tally only (conventions.md §1 redaction rule) — "{name} — {n} vote(s)". */
      voteTally: (name: string, n: number) => `${name} — ${n} vote${n === 1 ? '' : 's'}`,
    },
    standings: {
      title: "Tonight's standings",
      mvpLabel: "Tonight's MVP",
    },
    /** Guest-identity caveat — honest, no dark patterns, per §12. */
    guestCaveat:
      "This scrapbook lives on your browser, not an account — nobody's built those yet. New device or a wiped cache means a clean slate.",
  },
  /** arch/copy.md §15 — Word pack manager & editor (phase 11). */
  packs: {
    manager: {
      title: 'Your word packs',
      tabs: {
        mine: 'Mine',
        official: 'Official',
      },
      createButton: 'Create a pack',
      createForm: {
        nameLabel: 'Pack name',
        namePlaceholder: 'The Johnson Family Reunion, Vol. 3',
        descriptionLabel: "What's it about? (optional)",
        descriptionPlaceholder: 'Inside jokes only the cousins will get.',
      },
      cardMeta: (n: number) => `${n} pairs`,
      importedFrom: (ownerName: string) => `Imported from ${ownerName}`,
      /** Fallback when `Pack.ownerName` couldn't be resolved (copy.md §15 note). */
      importedFromFallback: 'a friend',
      emptyMine: 'No packs of your own yet. Build one — inside jokes make the best words.',
      emptyImports: 'Nothing imported yet. Got a code from a friend? Drop it in above.',
      addCoverButton: 'Add a cover',
      changeCoverButton: 'Change cover',
    },
    editor: {
      sectionLabel: 'The pairs',
      helper: "Same category, one meaningful difference — that's the whole trick.",
      wordALabel: 'Word A',
      wordBLabel: 'Word B',
      addPairsButton: 'Add pairs',
      bulkPaste: {
        label: 'Paste pairs',
        helper: "One pair per line — word;word. We'll sort the difficulty later.",
        placeholder: 'sofa;armchair\nmustache;beard\napartment;house',
      },
      validation: {
        duplicate: 'Already in this pack.',
        nearIdentical: 'These look like the same word. Try a sharper difference.',
        tooLong: 'Keep it under 40 characters.',
      },
      goodPairCard: {
        headline: 'What makes a good pair?',
        body: 'Same category, one meaningful difference — close enough that the sketchy one can survive a few rounds, different enough that a sharp table catches them.',
        examples: 'Easy: Cat / Dog. Medium: Coffee / Tea. Hard: River / Canal.',
      },
      emptyPairs: 'No pairs yet. Paste a batch or add your first one below.',
      loadMore: 'Load more pairs',
    },
    sharing: {
      shareButton: 'Share this pack',
      shareConfirm: {
        title: 'Share this pack?',
        description:
          "Sharing turns on a code anyone can use to add this pack to their own table. They still can't edit it.",
        confirm: 'Share it',
        cancel: 'Not yet',
      },
      makePublicButton: 'Make public',
      makePublicConfirm: {
        title: 'Add to the public catalog?',
        description:
          'This adds your pack to the public catalog — anyone can find and use it. You can make it private again anytime.',
        confirm: 'Make it public',
        cancel: 'Not yet',
      },
      shareCodeLabel: 'Share code',
      importFieldLabel: 'Got a code?',
      importPlaceholder: 'SHARECODE',
      importSubmit: 'Import',
      importSuccess: 'Added to your table. Find it under Mine.',
    },
    deleteConfirm: {
      title: 'Delete pack?',
      description: (name: string) => `Delete '${name}'? This can't be undone.`,
      confirm: 'Delete it',
      cancel: 'Keep it',
    },
    /**
     * Owner-facing indicator that a pack is in the public catalog (`visibility==='public'`).
     * Going public is self-service and immediate, so this simply confirms the current state
     * rather than signalling any wait.
     */
    review: {
      publicBadge: 'Public',
      publicHelper: 'This pack is in the public catalog — anyone can find and use it.',
    },
    /**
     * Public-catalog browser (`/packs/browse`) — discover packs other players opened to
     * everyone and add them to your own set (an import-by-id grant), so they show up under
     * Mine and in the room pack picker. The counterpart to the owner-facing "Make public".
     */
    browse: {
      title: 'Browse public packs',
      subtitle: 'Packs the community opened up. Add one and it lands under Mine.',
      searchLabel: 'Search packs',
      searchPlaceholder: 'Search by name…',
      searchSubmit: 'Search',
      addButton: 'Add to my packs',
      addedButton: 'Added',
      loadMore: 'Load more packs',
      empty: 'No public packs to add right now. Check back — or make one of yours public.',
      error: "Couldn't load the catalog just now. Give it a moment and try again.",
    },
  },
  /**
   * arch/copy.md §17 — Public matchmaking, accounts & moderation (phase 16). One top-level
   * key with `account` / `publicRoom` / `quickJoin` / `moderation` / `community` sub-blocks,
   * mirrored verbatim from the doc (tone §12).
   */
  matchmaking: {
    account: {
      upsellHeading: 'Claim your scrapbook',
      upsellBody:
        'Link an email and your games follow you to any device. No password, no spam — just a one-time link when you want back in. Guests keep playing private rooms forever without it.',
      linkButton: 'Link my email',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      sendButton: 'Send me a link',
      /** "Sign in with Google" — the label/aria for the optional Google link method
       * (rendered only when NEXT_PUBLIC_GOOGLE_CLIENT_ID is configured). `googleDivider`
       * separates it from the email form; `googleDisclosure` is the honest data line
       * (§12) required for the OAuth consent screen. */
      googleDivider: 'or',
      googleButton: 'Sign in with Google',
      googleDisclosure:
        'We only receive your verified email to create or link your account — nothing is posted anywhere, and we never sell or share it. Google may set its own cookies as part of signing in.',
      /** 13+ age requirement, shown in the link dialog itself — the point where an
       * account is actually created. The privacy policy + terms state it, but it belongs
       * here too, and applies to BOTH link methods (email magic link and Google). */
      ageDisclosure: 'You must be 13 or older to create a Sketchy account.',
      sentConfirmation:
        "Check your email. If it can be linked, a one-time link is on its way. (No email? It happens — request another in a minute.)",
      verifyLoading: 'Linking your scrapbook…',
      verifySuccessHeading: "You're linked. Your scrapbook is safe now.",
      verifySuccessCta: 'Back to the table',
      verifyFailure: "That link's expired or already used. Request a fresh one from your profile.",
      verifyFailureCta: 'Back to home',
      gateHeading: 'Accounts unlock strangers',
      gateBody:
        "Playing with people you haven't met needs a linked email — it's how reports and blocks actually mean something. Private rooms never do.",
      gateKeepPrivate: 'Keep it private',
      guestCaveat:
        'This scrapbook lives on this browser. Link an email to keep it across devices — or keep playing as a guest, your call.',
      /**
       * Self-service account deletion (copy.md §17.1) — shown ONLY for a LINKED
       * account on `/profile`. Honest about what deletion actually does (§12,
       * no dark patterns): the record is soft-anonymized (name, email, doodle
       * scrubbed) and only the moderation history required to keep the game safe
       * is kept. `confirmWord` is BOTH the word shown in the label and the exact
       * string the type-to-confirm compares against — one source of truth so the
       * two can't drift.
       */
      deleteAccount: {
        heading: 'Delete account',
        blurb:
          'Anonymize your record and unlink your email. This is the danger zone — it can’t be undone.',
        trigger: 'Delete account',
        warning:
          "This scrubs your name, linked email, and doodle for good, and logs you out here. We keep an anonymized record only where it's needed to keep the game safe — the moderation history tied to any reports or blocks. There's no undo.",
        confirmWord: 'DELETE',
        confirmLabel: 'Type DELETE to confirm',
        confirmButton: 'Delete my account',
        cancel: 'Keep my account',
        pending: 'Deleting…',
        success: 'Your account has been deleted. Thanks for playing.',
      },
    },
    publicRoom: {
      visibilityLabel: 'Make this room public',
      visibilityHelper:
        'Public rooms show up in the browser and quick-join. Timers on, spice roles off, voice off — the stranger-safe defaults.',
      visibilityGuestHelper: 'Link an email to host a public room.',
      publicChip: 'Public table',
      browserTitle: 'Find a table',
      browserSubtitle: 'Public rooms looking for players right now.',
      /** copy.md §9 public-lobbies empty state. */
      browserEmpty: "Nobody's hosting right now. Be the somebody.",
      hostTable: (hostName: string) => `${hostName}'s table`,
      playerCount: (count: number, max: number) => `${count}/${max} players`,
      join: 'Join',
      hostPublic: 'Host a public room',
      refresh: 'Refresh',
      loadMore: 'Load more tables',
      /** copy.md §17.2 — browser gate shown to a visitor without a session
       * yet (browsing public tables needs an account, same rule the server
       * enforces). Paired with the `account.linkButton` affordance. */
      browseGate: 'Sign in to browse public tables.',
    },
    quickJoin: {
      button: 'Quick join',
      buttonHelper: "Drop into a game with whoever's around.",
      searchingHeading: 'Finding you a table…',
      searchingBody:
        'Matching you with players looking for a game. Hang tight — this is usually quick.',
      cancel: 'Cancel',
      fallbackBody:
        'Still quiet out there. Want to start a table of your own and let others find you?',
      keepWaiting: 'Keep waiting',
      matchedToast: 'Found one. Taking you in…',
      // Shown when the enqueue is rejected (rate-limit / suspension / validation) or the
      // matchmaking socket drops — the searching modal stays open and swaps in this heading
      // plus the mapped `errors.*` line, so a failure never looks like a silent cancel.
      errorHeading: "Couldn't join a table",
      retry: 'Try again',
    },
    moderation: {
      report: 'Report',
      block: 'Block',
      /** copy.md §17.4 — screen-reader label for the per-player "Report ·
       * Block" affordance. The visible control is identical for every player,
       * so name it to keep the buttons distinguishable to a screen reader. */
      moderateAria: (name: string) => `Report or block ${name}`,
      /** copy.md §17.4 — screen-reader-only description for the report/block
       * menu dialog (Radix requires a `Dialog.Description`; there's no room for
       * a visible line above three action buttons). */
      menuDescription: (name: string) => `Choose what to do about ${name}.`,
      kickAndReport: 'Kick & report',
      reportTitle: (name: string) => `Report ${name}?`,
      reportBody:
        "Tell us what's off. This goes to a human, with the room's recent chat and clues for context.",
      reasonName: 'Their name',
      reasonChat: 'Chat',
      reasonClue: 'Clues',
      reasonOther: 'Something else',
      reportDetailLabel: 'Anything to add? (optional)',
      reportDetailPlaceholder: 'What happened…',
      reportSend: 'Send report',
      cancel: 'Never mind',
      reportSentToast: "Thanks — we're on it. They won't know who reported them.",
      blockTitle: (name: string) => `Block ${name}?`,
      blockBody:
        "You won't be matched with them again, and their messages get hidden for you. You can undo this anytime.",
      blockConfirm: 'Block them',
      blockCancel: 'Cancel',
      blockedToast: "Blocked. You won't cross paths in matchmaking again.",
      unblock: 'Unblock',
      blockedListHeading: 'Blocked players',
      blockedListEmpty: "You haven't blocked anyone. A peaceful existence.",
      kickReportConfirm: (name: string) =>
        `Kick and report ${name}? They're out of this room, and a human reviews the report.`,
      kickReportButton: 'Kick & report',
      chatHidden: 'Message hidden (blocked).',
    },
    community: {
      title: 'How we play nice',
      intro:
        "Sketchy is bluffing, accusing, and dramatic betrayal — all in good fun. Here's the short version of keeping it fun for everyone at the table.",
      vibeHeading: 'The vibe',
      vibe: [
        'Play to win, not to wound — tease the table, not the person.',
        'Keep names, clues, and chat printable. Public rooms hold a stricter line.',
        "Assume good faith. Everyone's new at some point.",
        'Lost? Ask. Winning by confusion is a Mister White move, not a house rule.',
      ],
      notCoolHeading: 'Not cool anywhere',
      notCool: [
        'Slurs, harassment, or targeting someone — instant exit.',
        "Sharing anyone's real-world info.",
        'Trying to break, flood, or scrape the game.',
      ],
      toolsHeading: "You've got tools",
      toolsBody:
        'See something off? Report it (a human reviews it, with context) or Block the player (you won’t be matched again). Hosts can kick, and repeat offenders get warned or suspended.',
      closing: "That's it. Be the friend people want at the table.",
      back: 'Back',
      footerLink: 'Community expectations',
    },
  },
  /**
   * arch/copy.md §16 — Marketing site (phase 14): the server-rendered `/`, `/about`,
   * `/faq`, `/privacy`, `/terms` pages, the shared site nav/footer, and the SEO surface
   * (per-page metadata + OG image copy). Kept under one top-level key
   * (apps/web/src/copy.ts gets a single new `marketing` key).
   */
  marketing: {
    nav: {
      skipToContent: 'Skip to main content',
      /** `<nav aria-label>` — a landmark name, never rendered as visible text. */
      navLabel: 'Main',
      about: 'About',
      faq: 'FAQ',
      howToPlay: 'How to play',
    },
    footer: {
      columnHeadings: {
        product: 'Product',
        legal: 'Legal',
        credits: 'Credits',
      },
      links: {
        about: 'About',
        faq: 'FAQ',
        howToPlay: 'How to play',
        privacy: 'Privacy',
        terms: 'Terms',
        github: 'GitHub',
      },
      creditsLine:
        'Illustrations: Open Doodles (CC0). Icons: Lucide (ISC). Fonts: Archivo Black & Space Grotesk (OFL 1.1).',
      /** Reuses `copy.home.footer` verbatim in a new position. */
      tagline: 'Best with 6–12 players and at least one dramatic friend.',
      copyright: (year: number) => `© ${year} Sketchy.`,
    },
    /** `title.template` for every page except the landing, which sets a full override. */
    seo: {
      titleTemplate: '%s · Sketchy',
    },
    landing: {
      meta: {
        title: 'Sketchy — the social deduction party game',
        description:
          'A social deduction party game for 3–20 players. Everyone gets a secret word — except the impostors. Free pass-and-play, no app required, or host a private room.',
      },
      hero: {
        eyebrow: 'A party game for 3–20 players',
        /** Split into three parts so the highlighted word gets its own
         * highlight-sticker span (design-party-pop.md §7) inside the page's one <h1>. */
        headlinePrefix: "Everyone's a little",
        headlineHighlight: 'sketchy',
        headlineSuffix: '.',
        /** copy.md §1's marketing-page alt tagline, verbatim. */
        subhead: 'One word apart. One liar among you. Draw your own conclusions.',
      },
      howItWorks: {
        sectionHeading: 'How it actually works',
        steps: [
          {
            eyebrow: 'Step 1',
            title: 'Get your word',
            body: "Everyone at the table gets the same secret word — except the impostors, who get something close but not quite right. One poor soul gets nothing at all.",
            doodleAlt: 'Hand-drawn doodle of a person excitedly unboxing a package',
          },
          {
            eyebrow: 'Step 2',
            title: "Describe, don't confess",
            body: 'One clue at a time, out loud. Too obvious and you help the impostors blend in. Too vague and you start looking like one yourself.',
            doodleAlt: 'Hand-drawn doodle of a person striking a self-conscious selfie pose',
          },
          {
            eyebrow: 'Step 3',
            title: 'Vote out the sketchy one',
            body: 'Argue, accuse, vote. Guess wrong and the impostors walk away with it. Catch Mister White and they still get one last, desperate guess to steal the win anyway.',
            doodleAlt: 'Hand-drawn doodle of a person dancing mid-celebration',
          },
        ],
      },
      /** Renders nothing when `gamesToday` isn't available — see `lib/admin-stats.ts` for
       * the public `GET /v1/stats/games-today` call and the honest "today, not all-time"
       * framing. */
      socialProof: {
        caption: 'Tables started today',
        supporting: 'Grab a few friends — yours could be next.',
      },
      secondaryCta: {
        eyebrow: 'Already know the rules?',
      },
      /** Small, honest captions in the right-hand entry card, next to `Create a room`
       * (arch/copy.md §16.2). Clues are unfiltered free text, and voice is built in but
       * optional — surfacing both here sets expectations before a host commits to a room,
       * rather than leaving them buried in the FAQ. */
      entryReassurance: {
        clueTrust: 'Clues are free text — play with people you trust.',
        voice: "Voice chat's built into private rooms — or pair with a Discord or video call.",
      },
      /** Quiet inline link in the secondary CTA band pointing at the existing `/faq`,
       * which otherwise only appeared in the footer (arch/copy.md §16.2). */
      questionsLink: 'Got questions? Read the FAQ.',
      /** Context heading above `NamePromptCard` now that the page's <h1> is the hero
       * headline, not the old brand-lockup block. */
      identityPanelHeading: 'Your seat at the table',
      og: {
        eyebrow: 'A party game for 3–20 players',
        title: 'Sketchy',
        subtitle: "Everyone's a little sketchy.",
      },
    },
    about: {
      meta: {
        title: 'About',
        description:
          "Why we built Sketchy, what makes it different, and who it's for. No corporate mission statement.",
      },
      title: 'So, what is Sketchy?',
      paragraphs: [
        "Every group has one. The friend who can describe 'lighthouse' for ninety seconds without ever quite saying what it does. Sketchy is built for that friend — and for the rest of the table figuring out whether they're bluffing or just bad at charades.",
        "The rules are old — this style of social deduction has been a party-game staple for years. What we changed is the friction: no app store, no sign-up wall, no fumbling for a deck of cards. Open a link, get a name, get a word. The game starts in under a minute.",
        "Pass-and-play works on one phone, no internet required, for the couch. Private rooms work over a room code, for everyone else — pair it with a Discord call and it's basically a séance with scoring.",
        "We're not chasing an app-store ranking. We're chasing the moment your table goes dead silent because someone just realized their best friend has been lying to them for four rounds straight. That's the whole product.",
      ],
      closingLine: 'Built by people who kept losing at this game and got suspicious about why.',
      og: {
        eyebrow: 'About',
        title: 'So, what is Sketchy?',
        subtitle: "The friend who describes 'lighthouse' for ninety seconds.",
      },
    },
    faq: {
      meta: {
        title: 'FAQ',
        description:
          'Real answers for first-time hosts and players: player counts, accounts, pricing, voice chat, and how pass-and-play actually works.',
      },
      title: 'Questions people actually ask',
      intro: "The short, honest answers — not a wall of legal text pretending to be helpful.",
      /** Rendered as a plain server-rendered list (no accordion) so every answer is
       * visible to a first-time visitor and a crawler alike, and feeds the `FAQPage`
       * JSON-LD from this SAME array. */
      items: [
        {
          question: 'What is Sketchy?',
          answer:
            'A social deduction party game for 3–20 players. Everyone gets a secret word — except the players who got a slightly different one, and the one who got nothing at all. Describe, accuse, vote, and try not to look sketchy.',
        },
        {
          question: 'How many players do I need?',
          answer:
            "Three is the floor, twenty is the ceiling. It's genuinely fun from six players up, and best with at least one dramatic friend.",
        },
        {
          question: 'Do I need to download anything?',
          answer:
            'No. It runs in your browser. Pass-and-play works offline on one phone; private rooms need everyone online, but nobody installs an app.',
        },
        {
          question: 'Do I need an account?',
          answer:
            'No. Tell us a name and you’re in. No email, no password. If you play online games, a lightweight scrapbook of your history lives on that browser — see our privacy page for exactly what that means.',
        },
        {
          question: "What's the difference between pass-and-play and a private room?",
          answer:
            'Pass-and-play is one device passed around the table, fully offline. A private room is a room code you share — everyone joins from their own phone, from anywhere.',
        },
        {
          question: 'What happens if someone catches Mister White?',
          answer:
            "They're not out yet — Mister White gets one last guess at the Civilians' secret word. Guess right, and they steal the win on the spot.",
        },
        {
          question: 'Can we use our own words instead of the built-in packs?',
          answer:
            'Yes — build a word pack with your own pairs (inside jokes encouraged) and bring it to the table alongside the official packs.',
        },
        {
          question: 'Is it free?',
          answer: 'Yes. No tiers, no paywalled packs at launch.',
        },
        {
          question: 'Is there voice chat?',
          answer:
            "Yes — tap Join voiceonce you're in a room and you're talking to the table, no extra app. Still prefer a Discord or FaceTime call? That works exactly as well — plenty of tables stick with it.",
        },
        {
          question: 'Do you sell my data?',
          answer:
            'No. See our privacy page — the short version is we collect the minimum to run the game and never sell or trade it.',
        },
        {
          question: 'Is there any moderation?',
          answer:
            'Clues, names, and chat are free text, so we lean on the table and a few shared tools more than an auto-filter. Anyone playing online can report or block, hosts can kick, and public rooms hold a stricter line.',
          /** The one FAQ answer with a trailing inline link. `faq/page.tsx` renders this
           * as an anchor after the plain answer, while `FaqJsonLd` keeps using the
           * plain-text `answer` — so the structured data stays link-free and never drifts
           * from the visible text. Label matches the site-wide `/community` links
           * (`copy.matchmaking.community.footerLink`). */
          link: { href: '/community', label: 'Community expectations' },
        },
      ],
      og: {
        eyebrow: 'FAQ',
        title: 'Questions people actually ask',
        subtitle: 'Player counts, accounts, pricing, voice chat — answered.',
      },
    },
    privacy: {
      meta: {
        title: 'Privacy',
        description:
          'How Sketchy handles your name, your games, and your data — in plain language.',
      },
      draftBanner: 'DRAFT — the product owner must review this page before public launch.',
      title: 'Privacy',
      intro:
        "Sketchy is guest-first: you can play with just a name — no email, no password. You can optionally link an email, and public matchmaking with strangers requires it. Here's exactly what that means for your data, in plain language.",
      sections: [
        {
          heading: 'What we collect',
          body: 'Your display name (2–20 characters) and the doodle avatar you build from a handful of preset shapes — never a photo, never real-world identity info. That’s the whole guest profile. If you link an account, we also store the email address you link — and nothing else. You can link that email two ways: an email magic link, or Sign in with Google (see “Sign in with Google” below); either way, the email address is all we keep.',
        },
        {
          heading: 'Linking an email',
          body: 'You can link an email to your guest identity so your scrapbook survives a new device or a cleared browser, and it upgrades your existing guest identity in place — same player, same history, nothing lost. We store that email, send it a one-time sign-in link when you ask, and use it for nothing else — no marketing, no newsletters, no sharing. You can play private, room-code games forever without linking one; public matchmaking (quick join and the public lobby browser) is the only thing that requires a linked account, because letting strangers find each other needs some accountability.',
        },
        {
          heading: 'Sign in with Google',
          body: "Sign in with Google is an optional, alternative way to link an account — you never have to use it, and where it's offered it sits next to the email option. If you choose it, all we receive from Google is your verified email address, which we use only to create or link your account, exactly like the email option above — we don't receive or store your Google password, contacts, or profile beyond that email, we never post anything to your Google account, and we never sell or share what we receive. Google runs its own sign-in flow to hand us that verified email, so Google may set its own cookies during it — that part is governed by Google's own privacy policy, not ours.",
        },
        {
          heading: 'How your identity works',
          body: "Signing in with just a name creates a guest identity and a long-lived login token that lives in your browser's local storage — Sketchy's own login is never stored in a cookie. There's no password to lose, but there's also no self-serve recovery flow: a wiped browser or a new device means a clean slate unless you'd linked an email (by magic link or Google) first.",
        },
        {
          heading: 'Cookies',
          body: "Sketchy sets no cookies of its own, uses no ad trackers, and does no cross-site tracking of any kind. Your login token, sound/mute preference, and a few onboarding-hint flags live in your browser's local storage instead — data that stays on your device and is never sent to anyone but our own API. The one exception is optional: if you choose Sign in with Google, Google may set its own cookies as part of running that sign-in (see Google's privacy policy) — you only ever encounter that if you use the Google button. You'll see a one-time notice about our local-storage use the first time you visit; dismissing it just remembers your choice, also in local storage.",
        },
        {
          heading: 'Pass-and-play stays on your device',
          body: "Playing pass-and-play on one phone never touches our servers — the whole game (players, words, scores) lives in that browser's local storage until you clear it.",
        },
        {
          heading: 'Online rooms',
          body: 'Live online games run on our servers temporarily so everyone can stay in sync, and that room data expires automatically about a day after the room goes quiet. Once an online game finishes, we keep a summary (who played, roles, scores, clues, votes) tied to your guest identity so it can show up in your scrapbook — abandoned games get cleaned up instead of kept forever.',
        },
        {
          heading: 'Word packs you create',
          body: 'If you build a custom word pack, its words, pairs, and any cover image you upload are stored (cover images live on our storage provider, Cloudflare R2) so you — and anyone you share it with — can use them. Packs that violate the acceptable-use rules in our Terms can be retired from the shared pool by a moderator.',
        },
        {
          heading: 'Voice chat (optional, in-room only)',
          body: "If a host turns on in-game voice, audio flows directly between players through a relay server (LiveKit) purely to connect the call — we don't record, store, or review voice audio anywhere, on our servers or otherwise. Voice defaults to off, and public rooms don't offer it at all.",
        },
        {
          heading: 'Reporting, blocking & moderation',
          body: "If you or someone else files a report, we capture the recent chat and clue lines from that room (up to the last 20) at the moment of the report, so a human reviewer has context — this is captured automatically server-side, not something you attach yourself. Reports, the players named in them, and any moderation action taken (warning, suspension, retiring a pack) are logged. If you block another player, that pairing is stored so matchmaking never seats you together again, and their messages are hidden from you locally.",
        },
        {
          heading: 'IP addresses',
          body: "We use your IP address only to rate-limit abusive traffic (things like rapid-fire room creation or repeated sign-in attempts) — it's held in short-lived counters (on the order of a couple of minutes) purely to enforce those limits, not logged or stored long-term, and never tied to your player profile.",
        },
        {
          heading: 'Error tracking',
          body: "We use Sentry, a crash-reporting service, for technical errors only. Events are tagged with your anonymous player ID (and room code, if you were in one) so we can debug a specific report — never your name, words, clues, votes, or game state, which are explicitly stripped before anything leaves your browser.",
        },
        {
          heading: 'Who we share data with',
          body: "Nobody, in the sense of selling or advertising. A short list of infrastructure providers processes data only to keep the service running: our hosting provider, Cloudflare R2 (word-pack images and database backups), Sentry (crash reports, as above), and — only once you link an email — our transactional email provider, solely to deliver your sign-in link. If you choose Sign in with Google, Google acts as the identity provider for that one flow (it verifies your email and hands it to us); we don't send Google anything about your games.",
        },
        {
          heading: 'Admin & operations',
          body: 'A small internal ops view shows aggregate counts (active rooms, connected players, games played today) to help us keep the service healthy. It contains no personal data — no names, no emails, no game content.',
        },
        {
          heading: 'Your control over your data',
          body: "You can delete your account any time from your profile: we anonymize your record on the spot — your display name, linked email, and doodle are scrubbed — and keep only the moderation history (reports and blocks) required to keep the game safe for everyone. It takes effect immediately and can't be undone. Clearing your browser's local storage ends your local session too, but only deleting your account removes the linked-account data on our side. Questions, or want a hand? Email [CONTACT_EMAIL].",
        },
        {
          heading: 'Children',
          body: "Sketchy isn't directed at children under 13, and we don't knowingly collect data from them. This applies everywhere in the game, including linking an email and playing in public rooms with strangers.",
        },
        {
          heading: 'Changes',
          body: "This policy will change as the product does. We'll update this page when it does.",
        },
        {
          heading: 'Contact',
          body: 'Questions about this policy: [CONTACT_EMAIL]',
        },
      ],
      og: {
        eyebrow: 'Legal',
        title: 'Privacy',
        subtitle: 'Your data, in plain language.',
      },
    },
    terms: {
      meta: {
        title: 'Terms',
        description:
          'The plain-language rules for playing Sketchy: your guest identity, your content, and what we promise.',
      },
      draftBanner: 'DRAFT — the product owner must review this page before public launch.',
      title: 'Terms',
      intro:
        "The plain-language rules for playing Sketchy. Using the game means you're agreeing to these.",
      sections: [
        {
          heading: 'The service',
          body: "Sketchy is a social deduction party game played pass-and-play on one device, in private room-code-based online rooms, or — if you link an account — in public rooms matched with other players. It's an actively evolving product — features described on this site reflect what's shipped today, not a roadmap promise.",
        },
        {
          heading: 'Your guest identity and account',
          body: "You play under a name you choose, without a password. You're responsible for the device and browser that identity lives in — we have no way to recover it if local storage is cleared and you never linked an email. You can link an account two optional ways — an email magic link or Sign in with Google — and either one upgrades your same identity in place; linking is required only for public matchmaking, and private, room-code games never require it. If you use Sign in with Google, your use of Google's sign-in is also subject to Google's own terms.",
        },
        {
          heading: 'Playing with strangers (public rooms & quick join)',
          body: "Public rooms and quick join match you with players you don't know. Public games always run with timers on and spice roles off, and use a stricter profanity filter on names, clues, and chat than private rooms do. You can block another player at any time so matchmaking never seats you with them again.",
        },
        {
          heading: 'Voice chat',
          body: "If a host enables in-game voice, you're connecting live audio with the other players in that room. It's off by default and unavailable in public rooms. Standard playing-nicely rules apply to what you say.",
        },
        {
          heading: 'Playing nicely',
          body: "Names, clues, chat, and word packs run through a profanity filter and length limits, and actions are rate-limited to keep the game fair and the servers healthy. Don't try to break, flood, or scrape the service, and don't harass, target, or share other players' real-world information.",
        },
        {
          heading: 'Reporting, blocking & enforcement',
          body: "You can report a player (with recent chat/clue context automatically captured for review) or block them outright. We review reports and can warn a player, suspend their access, or retire a word pack that violates these rules — a suspended account is rejected on sign-in with a plain explanation, not a detailed one, to avoid tipping off bad actors to exactly what triggered it.",
        },
        {
          heading: 'Your content',
          body: "Custom word packs, names, clues, and chat you submit are yours — you're responsible for them. We can remove content, or a whole pack, that violates the acceptable-use rules above.",
        },
        {
          heading: 'Age requirement',
          body: 'You must be 13 or older to use Sketchy, whether playing as a guest, linking an email, or playing in public rooms with strangers.',
        },
        {
          heading: 'No warranty',
          body: "Sketchy is provided as-is, actively being built, and can change or break without notice. We'll do our best to keep your games running smoothly, but we can't promise perfection.",
        },
        {
          heading: 'Limitation of liability',
          body: "To the extent the law allows it, we're not liable for damages arising from your use of a free party game. Play at your own (very low) risk.",
        },
        {
          heading: 'Changes',
          body: 'We may update these terms as the product changes; continuing to play after an update means you accept the new terms.',
        },
        {
          heading: 'Contact',
          body: 'Questions about these terms: [CONTACT_EMAIL]',
        },
      ],
      og: {
        eyebrow: 'Legal',
        title: 'Terms',
        subtitle: 'The plain-language rules.',
      },
    },
    /** Generic room metadata (design-party-pop.md-adjacent SEO rule): `/r/[code]`
     * NEVER surfaces the room code, player names, or word in a `<title>`/OG card — the
     * whole point is a card that reveals nothing if pasted into a chat. */
    room: {
      metaTitle: 'Private room',
      metaDescription: 'A private Sketchy room. Ask whoever invited you for the code.',
      og: {
        eyebrow: 'Private room',
        title: "You're invited to a game",
        subtitle: 'Join the table — no spoilers here.',
      },
    },
  },
} as const;

export type Copy = typeof copy;
