import { describe, expect, it } from 'vitest';
import { copy } from './copy';

describe('copy', () => {
  it('contains the §2 primary button strings verbatim', () => {
    expect(copy.home.primaryActions.playOnThisPhone).toBe('Play on this phone');
    expect(copy.home.primaryActions.createARoom).toBe('Create a room');
    expect(copy.home.primaryActions.joinARoom).toBe('Join a room');
  });

  it('contains the §2 secondary button strings verbatim', () => {
    expect(copy.home.secondaryActions.howToPlay).toBe('How to play');
    expect(copy.home.secondaryActions.wordPacks).toBe('Word packs');
    expect(copy.home.secondaryActions.myScrapbook).toBe('My scrapbook');
  });

  it('contains the §2 name-prompt strings verbatim', () => {
    expect(copy.home.namePrompt.question).toBe("What's your name?");
    expect(copy.home.namePrompt.placeholder).toBe('Name');
    expect(copy.home.namePrompt.helper).toBe('This is how you will appear to other players.');
    expect(copy.home.namePrompt.submit).toBe("Let's go");
  });

  it('contains the §9 error-copy strings this phase wired up, verbatim', () => {
    expect(copy.errors.profanity).toBe("Let's keep it printable. Try different words.");
    expect(copy.errors.rateLimited).toBe('Easy there. Give it a few seconds and try again.');
    expect(copy.errors.validation).toBe("That didn't look right — check it and try again.");
    expect(copy.errors.unauthorized).toBe(
      "Your session went stale. Refresh and you'll be back in.",
    );
    expect(copy.errors.networkOffline).toBe(
      "You're offline. Pass-and-play still works — online rooms will reconnect when you're back.",
    );
    expect(copy.errors.generic500).toBe(
      "Something broke on our end. It's not you, it's us. Try again in a moment.",
    );
  });

  it('contains the §3.1 role card strings verbatim, for all three roles', () => {
    expect(copy.roles.civilian.cardTitle).toBe('CIVILIAN');
    expect(copy.roles.civilian.wordLine).toBe('Your secret word:');
    expect(copy.roles.civilian.flavor).toBe("Most players got this same word. Someone didn't.");
    expect(copy.roles.civilian.goalLine).toBe(
      "Describe it. Watch. Vote out everyone who doesn't quite fit.",
    );
    expect(copy.roles.civilian.reminderChip).toBe("Don't say your word out loud. Obviously.");

    expect(copy.roles.undercover.cardTitle).toBe('UNDERCOVER');
    expect(copy.roles.undercover.wordLine).toBe('Your secret word:');
    expect(copy.roles.undercover.flavor).toBe(
      "Careful — your word is almost everyone else's word. Almost.",
    );
    expect(copy.roles.undercover.goalLine).toBe('Blend in. Sound confident. Survive the votes.');
    expect(copy.roles.undercover.reminderChip).toBe(
      "You don't know who's with you. Neither do they.",
    );

    expect(copy.roles.mrWhite.cardTitle).toBe('MISTER WHITE');
    expect(copy.roles.mrWhite.wordLine).toBe('Your secret word:');
    expect(copy.roles.mrWhite.blankLine).toBe('— nothing. You get nothing. —');
    expect(copy.roles.mrWhite.flavor).toBe(
      "Everyone else is describing a word. You're describing pure vibes.",
    );
    expect(copy.roles.mrWhite.goalLine).toBe(
      'Bluff your way through. If they catch you, guess their word to steal the win.',
    );
    expect(copy.roles.mrWhite.reminderChip).toBe('Listen hard. Every clue is a hint.');
  });

  it('contains the §3.1 deal-screen chrome and pass-and-play peek strings verbatim', () => {
    expect(copy.roles.dealChrome.pressAndHold).toBe('Press and hold to peek');
    expect(copy.roles.dealChrome.onRelease).toBe('Hidden. Very sneaky.');
    expect(copy.roles.dealChrome.confirm).toBe('Got it');
    expect(copy.roles.dealChrome.waitingForPeek(3)).toBe('Waiting for 3 players to peek…');

    expect(copy.pnp.passInterstitial.prompt('Priya')).toBe('Pass the phone to Priya');
    expect(copy.pnp.passInterstitial.confirm).toBe("That's me");
    expect(copy.pnp.passInterstitial.smallPrint).toBe('Everyone else, look away. Yes, you.');

    expect(copy.pnp.peekA11y.show).toBe('Show my card');
    expect(copy.pnp.peekA11y.hide).toBe('Hide my card');
  });

  it('contains the §4 avatar picker strings verbatim', () => {
    expect(copy.avatar.picker.heading).toBe('Your doodle');
    expect(copy.avatar.picker.helper).toBe('This is how the table sees you.');
    expect(copy.avatar.picker.rows.head).toBe('Head');
    expect(copy.avatar.picker.rows.face).toBe('Face');
    expect(copy.avatar.picker.rows.accessory).toBe('Extras');
    expect(copy.avatar.picker.previous('Head')).toBe('Previous Head');
    expect(copy.avatar.picker.next('Face')).toBe('Next Face');
    expect(copy.avatar.picker.inkColorNames.civilian).toBe('Civilian blue');
    expect(copy.avatar.picker.inkColorNames.undercover).toBe('Undercover red');
    expect(copy.avatar.picker.inkColorNames.mrwhite).toBe('Mister White violet');
    expect(copy.avatar.picker.inkColorNames.success).toBe('Success green');
    expect(copy.avatar.picker.inkColorNames.highlight).toBe('Highlight yellow');
  });

  it('contains the new §5 pass-and-play additions verbatim', () => {
    expect(copy.pnp.packPicker.header).toBe('The words');
    expect(copy.pnp.packPicker.helper).toBe("Pick a pack or three. We'll shuffle.");

    expect(copy.pnp.difficulty.easy).toBe('Easy');
    expect(copy.pnp.difficulty.medium).toBe('Medium');
    expect(copy.pnp.difficulty.hard).toBe('Hard');

    expect(copy.pnp.typedClues.toggleLabel).toBe('Write clues on the board');
    expect(copy.pnp.typedClues.toggleHelper).toBe(
      'Off: clues are spoken out loud. On: each player also pins a one-word note.',
    );

    expect(copy.pnp.openVote.toggleLabel).toBe('Open voting');
    expect(copy.pnp.openVote.toggleHelper).toBe(
      'One screen, the table points, one person records. Less passing, more arguing.',
    );
    expect(copy.pnp.openVote.instruction).toBe('Record each vote as the table calls it out.');

    expect(copy.pnp.steppers.roleMathError).toBe(
      'Too many impostors — civilians must outnumber the sketchy side.',
    );

    expect(copy.pnp.setup.offlinePacks).toBe(
      'Offline — the built-in starter pack is on the table.',
    );
  });

  it('contains the §5 setup, steppers, and resume strings verbatim', () => {
    expect(copy.pnp.setup.title).toBe("Who's playing?");
    expect(copy.pnp.setup.addPlayerPlaceholder).toBe('Add a name…');
    expect(copy.pnp.setup.playerCountWarning).toBe('Playable with 3, properly fun with 6+.');

    expect(copy.pnp.steppers.header).toBe('The cast');
    expect(copy.pnp.steppers.helper(6)).toBe(
      "We've suggested a mix for 6 players. Meddle at your own risk.",
    );

    expect(copy.pnp.afterPeek.passItOn).toBe('Pass it on');
    expect(copy.pnp.afterPeek.lastPlayer).toBe("Everyone's in. Start round 1");

    expect(copy.pnp.clueTracker.line('Sam')).toBe(
      'Sam, describe your word out loud. One word or a short phrase.',
    );
    expect(copy.pnp.clueTracker.next).toBe('Next player');

    expect(copy.pnp.voteHandoff('Jo')).toBe('Pass to Jo to vote — no peeking at the last ballot.');

    expect(copy.pnp.resume.prompt).toBe(
      'Pick up where you left off? Your last game is still on the table.',
    );
    expect(copy.pnp.resume.resume).toBe('Resume');
    expect(copy.pnp.resume.startFresh).toBe('Start fresh');
  });

  it('contains the §6 phase-status and clue-phase strings verbatim', () => {
    expect(copy.phases.status.roundClues(3)).toBe('Round 3 — Clues');
    expect(copy.phases.status.discussion).toBe('Discussion');
    expect(copy.phases.status.theVote).toBe('The Vote');
    expect(copy.phases.status.tiebreaker).toBe('Tiebreaker');
    expect(copy.phases.status.theReveal).toBe('The Reveal');

    expect(copy.phases.clue.yourTurn).toBe(
      'Your turn. One word or a short phrase about your secret word.',
    );
    expect(copy.phases.clue.placeholder).toBe('Your clue…');
    expect(copy.phases.clue.button).toBe('Pin it to the board');
    expect(copy.phases.clue.skipped).toBe('skipped');

    expect(copy.phases.discussion.banner).toBe('Talk it out. Who sounded a little… off?');
    expect(copy.phases.discussion.callTheVote).toBe('Call the vote');
  });

  it('contains the §6 online clue-phase additions verbatim (phase 6)', () => {
    expect(copy.phases.clue.thinking('Priya')).toBe('Priya is thinking…');
    expect(copy.phases.clue.skipButton).toBe('Skip their turn');
    expect(copy.phases.clue.skipConfirm('Priya')).toBe(
      'Skip Priya? They can still rejoin and play next round.',
    );
  });

  it('contains the §4 force-start confirm and §11 +60s strings verbatim (phase 6)', () => {
    expect(copy.rooms.ready.forceStartConfirm).toBe("Not everyone's ready. Start anyway?");
    expect(copy.rooms.ready.start).toBe('Start');
    expect(copy.rooms.ready.wait).toBe('Wait');
    expect(copy.glossary.extendTimer).toBe('+60s');
    expect(copy.glossary.cancel).toBe('Cancel');
  });

  it('contains the §6 voting strings, including the new Lock it in button, verbatim', () => {
    expect(copy.phases.voting.banner).toBe(
      'Vote to eliminate. Choose carefully — the majority rules.',
    );
    expect(copy.phases.voting.selfVoteTooltip).toBe("You can't vote for yourself. Bold, though.");
    expect(copy.phases.voting.ballotCast).toBe(
      'Ballot in. You can still change it until the vote closes.',
    );
    expect(copy.phases.voting.progress(2, 5)).toBe('2/5 have voted');
    expect(copy.phases.voting.lockItIn).toBe('Lock it in');
  });

  it('contains the §6 tiebreak, second-tie, and all-abstain strings verbatim', () => {
    expect(copy.phases.tiebreak('Sam and Jo')).toBe(
      "It's a tie between Sam and Jo. Each of them gives one more clue — then we vote again. No pressure.",
    );
    expect(copy.phases.secondTie).toBe(
      "The table can't decide. Nobody goes home this round — but nobody's off the hook either.",
    );
    expect(copy.phases.allAbstain).toBe('Nobody voted?! Fine. Everyone survives. For now.');
  });

  it('contains the §7 reveal buildup and role-reveal strings verbatim', () => {
    expect(copy.reveal.buildup.tableHasSpoken).toBe('The table has spoken.');
    expect(copy.reveal.buildup.playerIsOut('Priya')).toBe("Priya, you're out.");

    expect(copy.reveal.roleReveal.civilian('Priya')).toBe(
      "Priya was… a Civilian. Well. That's awkward for everyone who pointed.",
    );
    expect(copy.reveal.roleReveal.undercover('Priya')).toBe('Priya was… UNDERCOVER. Got one!');
    expect(copy.reveal.roleReveal.misterWhite('Priya')).toBe(
      'Priya was… MISTER WHITE. But wait — they get one guess…',
    );
  });

  it('contains the §7 Mr. White guess screen strings verbatim', () => {
    expect(copy.reveal.mrWhiteGuess.yours).toBe("One shot. What's the Civilians' word?");
    expect(copy.reveal.mrWhiteGuess.placeholder).toBe('Say the word…');
    expect(copy.reveal.mrWhiteGuess.button).toBe('Steal the win');
    expect(copy.reveal.mrWhiteGuess.othersWaiting).toBe(
      'Mister White is guessing… hold your breath.',
    );
  });

  it('contains the §7 guess-wrong and guess-right strings verbatim', () => {
    expect(copy.reveal.guessWrong('banana')).toBe(
      "'banana' — nope. Not even close. (Okay, maybe close.) They're out for real.",
    );
    expect(copy.reveal.guessRight('banana')).toBe(
      "MISTER WHITE STEALS IT. The word was 'banana' and they plucked it out of thin air. +6 points.",
    );
  });

  it('contains the §7 win-screen strings verbatim when the parts are joined', () => {
    const { civilians, undercover, infiltrators } = copy.reveal.winScreens;

    expect(`${civilians.headline} ${civilians.subline} ${civilians.points}`).toBe(
      'CASE CLOSED. The Civilians sniffed out every impostor. +2 points each.',
    );
    expect(`${undercover.headline} ${undercover.subline} ${undercover.points}`).toBe(
      'THEY NEVER SAW IT COMING. The Undercover walked among you the whole time. +10 points.',
    );
    expect(`${infiltrators.headline} ${infiltrators.subline} ${infiltrators.points}`).toBe(
      "FULL INFILTRATION. Undercover and Mister White split the table's trust — and the win. +10 / +6 points.",
    );
  });

  it('contains the §7 full-reveal, scoreboard, and end-CTA strings verbatim', () => {
    expect(copy.reveal.fullReveal.header).toBe('The whole truth:');
    expect(copy.reveal.fullReveal.pairLine('Ocean', 'Lake')).toBe(
      'Civilians had Ocean, Undercover had Lake.',
    );

    expect(copy.reveal.scoreboard.title).toBe("Tonight's scoreboard");
    expect(copy.reveal.scoreboard.lifetimeChip(42)).toBe('scrapbook total: 42');

    expect(copy.reveal.endCTAs.rematch).toBe('Rematch — same crew, new word');
    expect(copy.reveal.endCTAs.backToLobby).toBe('Back to lobby');
    expect(copy.reveal.endCTAs.waitingForHost('Priya')).toBe(
      'Waiting for Priya to deal the next one…',
    );
    expect(copy.reveal.endCTAs.leaveRoom).toBe('Leave room');
  });

  it('contains the §11 glossary strings the pass-and-play setup screen needs, verbatim', () => {
    expect(copy.glossary.startGame).toBe('Start game');
    expect(copy.glossary.delete).toBe('Delete');
  });

  it('contains the §4 rooms & invites strings verbatim (phase 5)', () => {
    expect(copy.rooms.hero.label).toBe('Room');
    expect(copy.rooms.hero.tagline).toBe('Tell your friends the code, or just send the link.');
    expect(copy.rooms.actions.copyCode).toBe('Copy code');
    expect(copy.rooms.actions.copyLink).toBe('Copy link');
    expect(copy.rooms.actions.copyInvite).toBe('Copy invite message');
    expect(copy.rooms.actions.copied).toBe('Copied.');

    expect(copy.rooms.inviteMessage('ABCJK', 'https://sketchy.example/r/ABCJK')).toBe(
      "Get in here — we're playing **Sketchy**.\n" +
        'Room code: **ABCJK**\n' +
        'https://sketchy.example/r/ABCJK\n' +
        "(3 minutes to learn. Nobody trusts anybody. It's great.)",
    );

    expect(copy.rooms.join.title).toBe('Join a room');
    expect(copy.rooms.join.placeholder).toBe('ROOM CODE');
    expect(copy.rooms.join.submit).toBe('Knock knock');

    expect(copy.rooms.ready.ready).toBe("I'm ready");
    expect(copy.rooms.ready.notReady).toBe('Hang on…');

    expect(copy.rooms.emptyState).toBe("It's quiet in here… too quiet. Invite some suspects.");
  });

  it('contains the §4 voice pill strings verbatim (phase 15)', () => {
    expect(copy.rooms.voice.pill.idle).toBe('Join voice');
    expect(copy.rooms.voice.pill.connecting).toBe('Connecting…');
    expect(copy.rooms.voice.pill.connected).toBe('Voice on');
    expect(copy.rooms.voice.pill.unavailable).toBe('Voice unavailable');
    expect(copy.rooms.voice.pill.denied).toBe('Mic blocked');
    expect(copy.rooms.voice.mute).toBe('Mute');
    expect(copy.rooms.voice.unmute).toBe('Unmute');
    expect(copy.rooms.voice.leave).toBe('Leave voice');
    expect(copy.rooms.voice.joinedToast('Priya')).toBe('Priya joined voice.');
    expect(copy.rooms.voice.leftToast('Priya')).toBe('Priya left voice.');
    expect(copy.errors.voiceDisabled).toBe(
      'Voice chat is turned off right now — the game itself is unaffected.',
    );
  });

  it('contains the PINNED §4 timer-preset strings verbatim (phase 5)', () => {
    expect(copy.rooms.timers.header).toBe('The clock');
    expect(copy.rooms.timers.helper).toBe('Untimed is best on a voice call.');
    expect(copy.rooms.timers.presetUntimed).toBe("Untimed — we're on a call");
    expect(copy.rooms.timers.presetStandard).toBe('Standard');
    expect(copy.rooms.timers.presetSpeedy).toBe('Speedy');
  });

  it('contains the phase-5 kick-confirm and chat-drawer additions verbatim', () => {
    expect(copy.rooms.kick.title).toBe('Kick player?');
    expect(copy.rooms.kick.description('Priya')).toBe('Kick Priya? They can knock again anytime.');
    expect(copy.rooms.kick.confirm).toBe('Kick them');
    expect(copy.rooms.kick.cancel).toBe('Keep them');

    expect(copy.rooms.chat.label).toBe('Message');
    expect(copy.rooms.chat.placeholder).toBe('Say something…');
    expect(copy.rooms.chat.send).toBe('Send');
  });

  it('contains the §8 presence & system event strings verbatim (phase 5)', () => {
    expect(copy.presence.playerJoined('Priya')).toBe('Priya slid into the room.');
    expect(copy.presence.playerLeft('Priya')).toBe('Priya left. Suspicious? Probably fine.');
    expect(copy.presence.playerDisconnected('Priya')).toBe(
      'Priya lost connection — holding their seat…',
    );
    expect(copy.presence.playerReconnected('Priya')).toBe('Priya is back. Act natural.');
    expect(copy.presence.hostChanged('Priya')).toBe('Priya holds the pencil now (new host).');
    expect(copy.presence.kickedSelf).toBe(
      'The host removed you from the room. Rooms are like that sometimes.',
    );
    expect(copy.presence.kickedOthers('Priya')).toBe('Priya was shown the door.');
    expect(copy.presence.timerExtended).toBe('The host added a minute. Use it wisely.');
    expect(copy.presence.reconnectingSelf).toBe('Reconnecting… your seat is safe.');
  });

  it('contains the PINNED §8 sessionSuperseded string verbatim (phase 5)', () => {
    expect(copy.presence.sessionSuperseded).toBe(
      'You opened this room somewhere else — this tab is paused.',
    );
  });

  it('contains the §9 room error codes added for phase 5, verbatim', () => {
    expect(copy.errors.roomNotFound).toBe(
      'No room with that code. Check it with whoever invited you — codes expire after a day.',
    );
    expect(copy.errors.roomInProgress).toBe(
      "They've already started this game. You can wait for the next round — ask them to rematch you in.",
    );
    expect(copy.errors.kicked).toBe(
      'The host removed you from the room. Rooms are like that sometimes.',
    );
    expect(copy.errors.packForbidden).toBe("You don't have access to that word pack.");
    expect(copy.errors.pairLimit(100)).toBe(
      "That's the limit for this pack (100 pairs). Quality over quantity.",
    );
    expect(copy.errors.roomExpired).toBe(
      'This room has expired. Start a fresh one — it takes five seconds.',
    );
  });

  it('contains the §10 cheat-sheet string verbatim (phase 5)', () => {
    expect(copy.howToPlay.cheatSheet).toBe(
      'Clue → Argue → Vote → Reveal. Repeat until somebody wins.',
    );
  });

  it('contains the §9 engine-reachable error codes added for phase 4, verbatim', () => {
    expect(copy.errors.roomFull(12)).toBe(
      'That room is packed (12 players). Someone has to leave before you can squeeze in.',
    );
    expect(copy.errors.nameTakenInRoom('Sam')).toBe(
      'Someone in this room already claimed that name. Pick a variant — Sam² has a ring to it.',
    );
    expect(copy.errors.notHost).toBe('Only the host can do that. Flattering that you tried.');
    expect(copy.errors.notYourTurn).toBe('Not your turn yet — the suspense is the point.');
    expect(copy.errors.wrongPhase).toBe('Too late (or too early) for that. The game moved on.');
    expect(copy.errors.alreadyVoted).toBe(
      "Your ballot's already in. You can change it until the vote closes.",
    );
    expect(copy.errors.clueRepeated).toBe(
      'Someone already used that clue this game. Original thoughts only.',
    );
    expect(copy.errors.clueIsSecretWord).toBe("That's… the word. You can't just say the word.");
  });

  it('contains the §14 profile/scrapbook strings verbatim (phase 10)', () => {
    expect(copy.profile.screenTitle).toBe('My scrapbook');
    expect(copy.profile.headline.scrapbookTotal).toBe('Scrapbook total');
    expect(copy.profile.headline.gamesPlayed).toBe('Games played');
    expect(copy.profile.headline.gamesWon).toBe('Games won');
    expect(copy.profile.byRole.header).toBe('By role');
    expect(copy.profile.byRole.statLine(3, 5)).toBe('3/5 won');
    expect(copy.profile.byRole.neverPlayed).toBe("Haven't played this one yet.");
    expect(copy.profile.sparkline.header).toBe('Points over time');
    expect(copy.profile.sparkline.helper(12)).toBe('Your last 12 games.');
    expect(copy.profile.history.header).toBe('Past games');
    expect(copy.profile.history.emptyState).toBe(
      'No games in the scrapbook yet. Go get suspected of something.',
    );
    expect(copy.profile.history.voteTally('Jo', 1)).toBe('Jo — 1 vote');
    expect(copy.profile.history.voteTally('Jo', 3)).toBe('Jo — 3 votes');
    expect(copy.profile.standings.title).toBe("Tonight's standings");
    expect(copy.profile.standings.mvpLabel).toBe("Tonight's MVP");
    expect(copy.profile.guestCaveat).toBe(
      "This scrapbook lives on your browser, not an account — nobody's built those yet. New device or a wiped cache means a clean slate.",
    );
  });

  it('contains the §15 word pack manager & editor strings verbatim (phase 11)', () => {
    expect(copy.packs.manager.title).toBe('Your word packs');
    expect(copy.packs.manager.tabs.mine).toBe('Mine');
    expect(copy.packs.manager.tabs.official).toBe('Official');
    expect(copy.packs.manager.createButton).toBe('Create a pack');
    expect(copy.packs.manager.cardMeta(30)).toBe('30 pairs');
    expect(copy.packs.manager.importedFrom('Priya')).toBe('Imported from Priya');
    expect(copy.packs.manager.emptyMine).toBe(
      'No packs of your own yet. Build one — inside jokes make the best words.',
    );

    expect(copy.packs.editor.sectionLabel).toBe('The pairs');
    expect(copy.packs.editor.addPairsButton).toBe('Add pairs');
    expect(copy.packs.editor.bulkPaste.label).toBe('Paste pairs');
    expect(copy.packs.editor.goodPairCard.headline).toBe('What makes a good pair?');
    expect(copy.packs.editor.validation.duplicate).toBe('Already in this pack.');

    expect(copy.packs.sharing.shareButton).toBe('Share this pack');
    expect(copy.packs.sharing.shareCodeLabel).toBe('Share code');
    expect(copy.packs.sharing.importSubmit).toBe('Import');

    expect(copy.packs.deleteConfirm.description('My Pack')).toBe(
      "Delete 'My Pack'? This can't be undone.",
    );

    expect(copy.errors.packLimit(20)).toBe(
      "That's the limit for packs on your account (20 packs). Retire one to make room.",
    );
    expect(copy.glossary.save).toBe('Save');
  });

  it('contains the §3.2 special-role strings verbatim (phase 12, wave 1)', () => {
    expect(copy.roles.special.sectionHeader).toBe('Spice (optional roles)');
    expect(copy.roles.special.sectionHelper).toBe(
      'All optional. Add one or two once your table knows the basics.',
    );

    expect(copy.roles.special.judge.toggleLabel).toBe('The Judge');
    expect(copy.roles.special.judge.description).toBe(
      "When a vote ties, the Judge decides who's out — even after they've been eliminated.",
    );
    expect(copy.roles.special.judge.dealCardLine).toBe("Ties are yours. Rule wisely, or don't.");
    expect(copy.roles.special.judge.waitingForDecision).toBe('The Judge is deciding…');
    expect(copy.roles.special.judge.tieAnnouncement).toBe(
      "It's a tie. The Judge gets the final say this time.",
    );

    expect(copy.roles.special.ghost.toggleLabel).toBe('The Ghost');
    expect(copy.roles.special.ghost.description).toBe(
      'Eliminated players keep chatting and voting from beyond. Death is not an excuse.',
    );
    expect(copy.roles.special.ghost.eliminatedBanner).toBe(
      "You're a Ghost. You still vote. Haunt responsibly.",
    );

    expect(copy.roles.special.jester.toggleLabel).toBe('The Jester');
    expect(copy.roles.special.jester.description).toBe(
      'If the Jester is the very first player voted out, they score +4 points for the drama.',
    );
    expect(copy.roles.special.jester.dealCardLine).toBe(
      'Getting caught first would be… kind of great for you?',
    );

    expect(copy.reveal.jesterBonus('Sam')).toBe(
      'Sam was the Jester. Getting caught first paid off — +4 points.',
    );
    expect(copy.roles.special.needsMorePlayers(5)).toBe('Needs 5+ players.');
  });

  it('contains the §3.2 special-role strings verbatim (phase 13, wave 2)', () => {
    expect(copy.roles.special.lovebirds.toggleLabel).toBe('The Lovebirds');
    expect(copy.roles.special.lovebirds.description).toBe(
      "Two players are secretly linked. If one goes down, so does the other.",
    );
    expect(copy.roles.special.lovebirds.dealCardLine('Sam')).toBe(
      "You're a Lovebird. Your fate is tied to Sam. Protect them — quietly.",
    );

    expect(copy.roles.special.grudge.toggleLabel).toBe('The Grudge');
    expect(copy.roles.special.grudge.description).toBe(
      'When the Grudge is eliminated, they drag one player down with them.',
    );
    expect(copy.roles.special.grudge.dealCardLine).toBe(
      "If you go down, someone's coming with you.",
    );

    expect(copy.roles.special.mirror.toggleLabel).toBe('The Mirror');
    expect(copy.roles.special.mirror.description).toBe(
      'The first time the table votes the Mirror out, the votes bounce back at the voters. Once.',
    );
    expect(copy.roles.special.mirror.dealCardLine).toBe(
      'The first mob that comes for you will regret it.',
    );

    expect(copy.roles.special.rivals.toggleLabel).toBe('The Rivals');
    expect(copy.roles.special.rivals.description).toBe(
      'Two players are secretly feuding: first one eliminated loses 2 points, the survivor gains 2.',
    );
    expect(copy.roles.special.rivals.dealCardLine('Sam')).toBe('You have a rival: Sam. Outlast them.');

    expect(copy.roles.special.mime.toggleLabel).toBe('The Mime');
    expect(copy.roles.special.mime.description).toBe(
      'Each round one random player must give their clue in gestures only. In-person rooms only.',
    );
    expect(copy.roles.special.mime.roundToast('Sam')).toBe(
      'Sam is the Mime this round — gestures only, not a word!',
    );
  });
});
