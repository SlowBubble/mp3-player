// Global variables
let currentTracks = [];
let currentTrackIndex = 0;
let audioPlayer = null;
let isPlaying = false;
let playbackRates = [1, 1.15, 1.25, 1.35];
let currentRateIndex = 0;
let progressUpdateInterval = null;
let listeningSessionStart = null;
let showingHiddenView = false;

const SORT_MODES = [
    { key: 'shortest', label: 'Sort (Small)' },
    { key: 'longest',  label: 'Sort (Big)'   },
    { key: 'newest',   label: 'Sort (Fresh)' },
    { key: 'oldest',   label: 'Sort (Stale)' },
];
let currentSortIndex = parseInt(localStorage.getItem('sortIndex') || '0', 10) % SORT_MODES.length;

// DOM elements
const fileInput = document.getElementById('file-input');
const playlist = document.getElementById('playlist');
const homePage = document.getElementById('home-page');
const playerPage = document.getElementById('player-page');
const playerControls = document.getElementById('player-controls');
const currentTrackTitle = document.getElementById('current-track-title');
const playPauseBtn = document.getElementById('play-pause-btn');
const progressFill = document.getElementById('progress-fill');
const currentTimeSpan = document.getElementById('current-time');
const totalTimeSpan = document.getElementById('total-time');
const progressBar = document.getElementById('progress-bar');

// Initialize the app
document.addEventListener('DOMContentLoaded', function () {
    audioPlayer = document.getElementById('audio-player');
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    // File input change
    fileInput.addEventListener('change', handleFileSelection);

    // Audio player events
    audioPlayer.addEventListener('loadedmetadata', updateDuration);
    audioPlayer.addEventListener('timeupdate', updateProgress);
    audioPlayer.addEventListener('ended', handleTrackEnd);
    // Progress bar click
    progressBar.addEventListener('click', seekToPosition);
}

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    const mp3Files = files.filter(file => file.type === 'audio/mpeg' || file.name.toLowerCase().endsWith('.mp3'));

    if (mp3Files.length === 0) {
        alert('No MP3 files found in the selected folder.');
        return;
    }

    currentTracks = mp3Files.map((file, index) => ({
        id: index,
        name: file.name.replace('.mp3', ''),
        file: file,
        size: file.size,
        lastModified: file.lastModified,
        url: URL.createObjectURL(file)
    }));

    displayPlaylist();
    preloadTrackDurations();

    // Navigate to the track page if there was an active track last session
    const lastActiveTrack = localStorage.getItem('lastActiveTrack');
    const resumeIndex = lastActiveTrack
        ? currentTracks.findIndex(t => t.name === lastActiveTrack)
        : -1;

    // Session restore: load the last active track's metadata but don't navigate or auto-play
    if (resumeIndex !== -1) {
        currentTrackIndex = resumeIndex;
        const track = currentTracks[resumeIndex];
        currentTrackTitle.textContent = track.name;
        audioPlayer.src = track.url;
        audioPlayer.load();
    }

    // Hide the select folder button, show sort + toggle hidden tracks
    document.getElementById('select-folder-container').style.display = 'none';
    document.getElementById('post-load-controls').style.display = 'block';
    document.getElementById('sort-btn').textContent = SORT_MODES[currentSortIndex].label;
}

// Display playlist
function displayPlaylist() {
    playlist.innerHTML = '';

    // Find the largest file size for proportional progress bars
    let longestSize = 0;
    currentTracks.forEach(track => {
        if ((track.size ?? 0) > longestSize) longestSize = track.size;
    });

    // Sort tracks according to current sort mode, with the active track pinned first
    const sortKey = SORT_MODES[currentSortIndex].key;
    const activeTrack = audioPlayer && audioPlayer.src ? currentTracks[currentTrackIndex] : null;
    const sortedTracks = [...currentTracks].sort((a, b) => {
        // Pin the active track to the top
        if (activeTrack) {
            if (a.id === activeTrack.id) return -1;
            if (b.id === activeTrack.id) return 1;
        }
        switch (sortKey) {
            case 'shortest': {
                const aDur = (getTrackProgress(a.name)?.duration) || estimateDuration(a.size) || (a.size ?? Infinity);
                const bDur = (getTrackProgress(b.name)?.duration) || estimateDuration(b.size) || (b.size ?? Infinity);
                return aDur - bDur;
            }
            case 'longest': {
                const aDur = (getTrackProgress(a.name)?.duration) || estimateDuration(a.size) || (a.size ?? 0);
                const bDur = (getTrackProgress(b.name)?.duration) || estimateDuration(b.size) || (b.size ?? 0);
                return bDur - aDur;
            }
            case 'newest':   return (b.lastModified ?? 0) - (a.lastModified ?? 0);
            case 'oldest':   return (a.lastModified ?? Infinity) - (b.lastModified ?? Infinity);
            default:         return 0;
        }
    });

    // Get hidden tracks list
    const hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');

    // Duration bucket breakpoints in seconds, with labels
    const DURATION_BUCKETS = [
        { maxSecs: 6 * 60,         label: 'under 6 min' },
        { maxSecs: 11 * 60,        label: 'under 11 min' },
        { maxSecs: 21 * 60,        label: 'under 21 min' },
        { maxSecs: 41 * 60,        label: 'under 41 min' },
        { maxSecs: 60 * 60,        label: 'under 1 hr' },
        { maxSecs: 2 * 60 * 60,    label: 'under 2 hr' },
        { maxSecs: 4 * 60 * 60,    label: 'under 4 hr' },
        { maxSecs: Infinity,       label: '4 hr+' },
    ];

    function getDurationBucket(secs) {
        return DURATION_BUCKETS.findIndex(b => secs < b.maxSecs);
    }

    function dateKey(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function formatDateLabel(ts) {
        return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    let prevTrack = null;
    let prevProgressData = null;

    sortedTracks.forEach((track) => {
        // Toggle filtering logic
        const isHidden = hiddenTracks.includes(track.name);
        if (showingHiddenView && !isHidden) return;
        if (!showingHiddenView && isHidden) return;

        // Find original index for playTrack function
        const originalIndex = currentTracks.findIndex(t => t.id === track.id);

        const trackElement = document.createElement('div');
        trackElement.className = 'track-wrapper';

        const isCurrentTrack = originalIndex === currentTrackIndex && audioPlayer && audioPlayer.src;

        const progressData = getTrackProgress(track.name);

        // Insert a labeled divider at bucket boundaries
        if (prevTrack !== null) {
            // Demarcation after the pinned active track
            if (activeTrack && prevTrack.id === activeTrack.id) {
                const divider = document.createElement('div');
                divider.className = 'track-divider';
                playlist.appendChild(divider);
            }

            let dividerLabel = null;
            if (sortKey === 'shortest' || sortKey === 'longest') {
                const curDur = (progressData && progressData.duration) || estimateDuration(track.size);
                const prevDur = (prevProgressData && prevProgressData.duration) || estimateDuration(prevTrack.size);
                if (curDur && prevDur) {
                    const curBucket = getDurationBucket(curDur);
                    const prevBucket = getDurationBucket(prevDur);
                    if (curBucket !== prevBucket) {
                        // Label describes the bucket we're entering
                        dividerLabel = DURATION_BUCKETS[curBucket].label;
                    }
                }
            } else if (sortKey === 'newest' || sortKey === 'oldest') {
                const curKey = dateKey(track.lastModified ?? 0);
                const prevKey = dateKey(prevTrack.lastModified ?? 0);
                if (curKey !== prevKey) {
                    dividerLabel = formatDateLabel(track.lastModified ?? 0);
                }
            }
            if (dividerLabel !== null) {
                const divider = document.createElement('div');
                divider.className = 'track-divider';
                divider.textContent = dividerLabel;
                playlist.appendChild(divider);
            }
        }

        let durationText = '';
        let progressPercentage = 0;
        let progressBarWidth = 100;

        // Progress bar width is proportional to file size
        if (longestSize > 0 && track.size) {
            progressBarWidth = (track.size / longestSize) * 100;
        }

        // Duration text: use saved duration if available, otherwise show file size
        if (progressData && progressData.duration) {
            const durationFormatted = formatTime(progressData.duration);
            if (progressData.currentTime > 0) {
                const currentTimeFormatted = formatTime(progressData.currentTime);
                durationText = `${currentTimeFormatted} / ${durationFormatted}`;
                progressPercentage = (progressData.currentTime / progressData.duration) * 100;
            } else {
                durationText = durationFormatted;
            }
        } else if (track.size) {
            durationText = formatFileSize(track.size);
        }

        const statsText = getTrackStatsText(progressData);

        const safeName = track.name.replace(/'/g, "\\'");
        const btnHtml = showingHiddenView
            ? `<button class="remove-track-btn restore-track-btn" style="background: rgba(74, 222, 128, 0.2);" onclick="unhideTrack(event, '${safeName}')" title="Restore to list">↺</button>`
            : `<button class="remove-track-btn" onclick="hideTrack(event, '${safeName}')" title="Remove from list">✕</button>`;

        trackElement.innerHTML = `
            <div class="track-item ${isCurrentTrack ? 'track-item--active' : ''}" onclick="playTrack(${originalIndex})">
                <div class="track-name" title="${track.name}">${track.name}</div>
                ${durationText ? `<div class="track-duration">${durationText}</div>` : ''}
                ${statsText ? `<div class="track-stats">${statsText}</div>` : ''}
                <div class="track-progress">
                    <div class="track-progress-bar" style="width: ${progressBarWidth}%">
                        <div class="track-progress-fill" style="width: ${progressPercentage}%"></div>
                    </div>
                </div>
            </div>
            ${btnHtml}
        `;

        playlist.appendChild(trackElement);
        prevTrack = track;
        prevProgressData = progressData;
    });
}

// Play a specific track
function playTrack(index) {
    if (index < 0 || index >= currentTracks.length) return;

    // Check if this is the currently playing track
    const isCurrentTrack = (index === currentTrackIndex && audioPlayer.src && isPlaying);

    // If it's the current track and already playing, just show the player page
    if (isCurrentTrack) {
        showPlayerPage();
        return;
    }

    currentTrackIndex = index;
    const track = currentTracks[index];

    // Update last played date and first listen date
    updateLastPlayedDate(track.name);

    // Persist as the last active track for session restore
    localStorage.setItem('lastActiveTrack', track.name);

    // Start listening session tracking
    listeningSessionStart = Date.now();

    // Update UI
    currentTrackTitle.textContent = track.name;

    // Load and play audio — skip if already primed with this URL (gesture unlock)
    if (audioPlayer.src !== track.url) {
        audioPlayer.src = track.url;
        audioPlayer.load();
    }

    // Show player page
    showPlayerPage();

    // Start playing
    isPlaying = true;
    updatePlayPauseButton();

    // Setup Media Session API for background playback
    setupMediaSession(track);

    // Start progress tracking interval
    startProgressTracking(track.name);

    // Restore saved position — if metadata is already loaded use it immediately,
    // otherwise wait for the loadedmetadata event
    function restorePosition() {
        const progressData = getTrackProgress(track.name);
        if (progressData && progressData.currentTime > 0) {
            audioPlayer.currentTime = Math.max(0, progressData.currentTime - 5);
        }
        audioPlayer.removeEventListener('loadedmetadata', restorePosition);
    }

    if (audioPlayer.readyState >= 1) {
        // Metadata already available (src was primed before playTrack was called)
        restorePosition();
    } else {
        audioPlayer.addEventListener('loadedmetadata', restorePosition);
    }

    // Try to play (may be blocked on mobile until user interaction)
    audioPlayer.play().catch(e => {
        console.log('Play blocked, waiting for user interaction:', e);
        isPlaying = false;
        updatePlayPauseButton();
    });
}

// Toggle play/pause
function togglePlayPause() {
    if (!audioPlayer.src) return;

    if (isPlaying) {
        audioPlayer.pause();
        isPlaying = false;

        // Save progress immediately when pausing
        const track = currentTracks[currentTrackIndex];
        if (track && audioPlayer.duration) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            const timeToSave = (duration - currentTime < 30) ? 0 : currentTime;

            // Add listening time from this session
            addListeningTime(track.name);

            const existingData = getTrackProgress(track.name) || {};
            const progressData = {
                duration: duration,
                currentTime: timeToSave,
                lastPlayed: existingData.lastPlayed || Date.now(),
                firstListened: existingData.firstListened,
                totalListeningTime: existingData.totalListeningTime || 0
            };
            saveTrackProgress(track.name, progressData);
        }
        updatePlayPauseButton();
        updateMediaSessionState();
    } else {
        audioPlayer.play().then(() => {
            isPlaying = true;
            updatePlayPauseButton();
            updateMediaSessionState();
        }).catch(e => {
            console.log('Play failed:', e);
            isPlaying = false;
            updatePlayPauseButton();
            updateMediaSessionState();
        });
    }
}

// Update play/pause button
function updatePlayPauseButton() {
    playPauseBtn.textContent = isPlaying ? '⏸️' : '▶️';
    playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
    document.body.classList.toggle('playing', isPlaying);
}

// Rewind 7 seconds
function rewind7() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 7);
    }
}

// Forward 7 seconds
function forward7() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 7);
    }
}

// Rewind 45 seconds
function rewind45() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 45);
    }
}

// Forward 45 seconds
function forward45() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 45);
    }
}

// Toggle playback rate
function togglePlaybackRate() {
    if (!audioPlayer.src) return;

    currentRateIndex = (currentRateIndex + 1) % playbackRates.length;
    const newRate = playbackRates[currentRateIndex];

    audioPlayer.playbackRate = newRate;

    // Update button text
    const rateBtn = document.getElementById('playback-rate-btn');
    rateBtn.textContent = newRate + 'x';

    // Update Media Session if available
    updateMediaSessionState();
}

// Restart current track
function restartTrack() {
    if (audioPlayer.src) {
        audioPlayer.currentTime = 0;
    }
}

// Chapter navigation (chapters = 10 equal segments: 0/10, 1/10, ..., 9/10)
function prevChapter() {
    if (!audioPlayer.src || !audioPlayer.duration) return;
    const chapterSize = audioPlayer.duration / 10;
    const currentChapter = Math.floor(audioPlayer.currentTime / chapterSize);
    // If we're more than 2s into the current chapter, go to its start; otherwise go to previous
    const chapterStart = currentChapter * chapterSize;
    if (audioPlayer.currentTime - chapterStart > 2 && currentChapter > 0) {
        audioPlayer.currentTime = chapterStart;
    } else {
        audioPlayer.currentTime = Math.max(0, (currentChapter - 1) * chapterSize);
    }
}

function nextChapter() {
    if (!audioPlayer.src || !audioPlayer.duration) return;
    const chapterSize = audioPlayer.duration / 10;
    // Add a small epsilon to avoid floating point issues where currentTime lands
    // just below a chapter boundary after a previous nextChapter call while paused
    const currentChapter = Math.floor((audioPlayer.currentTime + 0.01) / chapterSize);
    audioPlayer.currentTime = Math.min(audioPlayer.duration, (currentChapter + 1) * chapterSize);
}

// Update duration display
function updateDuration() {
    if (audioPlayer.duration) {
        totalTimeSpan.textContent = formatTime(audioPlayer.duration);

        // Store duration in localStorage when first loaded
        const track = currentTracks[currentTrackIndex];
        if (track) {
            const progressData = getTrackProgress(track.name) || {};
            progressData.duration = audioPlayer.duration;
            // Don't overwrite lastPlayed here, only when actually starting playback
            saveTrackProgress(track.name, progressData);
            // Record size→duration mapping for interpolation
            recordSizeDuration(track.size, audioPlayer.duration);
        }
    }
}

// Update progress
function updateProgress() {
    if (audioPlayer.duration) {
        const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressFill.style.width = progress + '%';
        currentTimeSpan.textContent = formatTime(audioPlayer.currentTime);

        // Update Media Session position periodically
        updateMediaSessionState();
    }
}

// Handle track end
function handleTrackEnd() {
    isPlaying = false;
    updatePlayPauseButton();

    // Save progress as completed (reset to 0)
    const track = currentTracks[currentTrackIndex];
    if (track && audioPlayer.duration) {
        // Add listening time from this session
        addListeningTime(track.name);

        const existingData = getTrackProgress(track.name) || {};
        const progressData = {
            duration: audioPlayer.duration,
            currentTime: 0,
            lastPlayed: existingData.lastPlayed || Date.now(),
            firstListened: existingData.firstListened,
            totalListeningTime: existingData.totalListeningTime || 0
        };
        saveTrackProgress(track.name, progressData);
    }

    // Auto-advance to the next track according to current sort order
    const nextIndex = getNextVisibleTrackIndex();
    if (nextIndex !== -1) {
        playTrack(nextIndex);
    } else {
        // No more tracks — refresh playlist to reflect completion state
        displayPlaylist();
    }
}

// Returns the index (in currentTracks) of the next non-hidden track after the current one,
// respecting the current sort order.
function getNextVisibleTrackIndex() {
    const hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');
    const sortKey = SORT_MODES[currentSortIndex].key;
    const activeTrack = currentTracks[currentTrackIndex];

    // Build the same sorted order used by displayPlaylist (without pinning the active track)
    const sorted = [...currentTracks].sort((a, b) => {
        switch (sortKey) {
            case 'shortest': return (a.size ?? Infinity) - (b.size ?? Infinity);
            case 'longest':  return (b.size ?? 0) - (a.size ?? 0);
            case 'newest':   return (b.lastModified ?? 0) - (a.lastModified ?? 0);
            case 'oldest':   return (a.lastModified ?? Infinity) - (b.lastModified ?? Infinity);
            default:         return 0;
        }
    });

    // Find the position of the current track in the sorted list, then pick the next visible one
    const currentSortedIndex = sorted.findIndex(t => t.id === activeTrack?.id);
    for (let i = currentSortedIndex + 1; i < sorted.length; i++) {
        if (!hiddenTracks.includes(sorted[i].name)) {
            return currentTracks.findIndex(t => t.id === sorted[i].id);
        }
    }
    return -1;
}

// Returns the index (in currentTracks) of the shortest non-hidden track, or -1 if none.
function getShortestVisibleTrackIndex() {
    const hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');

    const sorted = [...currentTracks].sort((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity));

    const next = sorted.find(track => !hiddenTracks.includes(track.name));
    if (!next) return -1;
    return currentTracks.findIndex(t => t.id === next.id);
}

// Seek to position
function seekToPosition(event) {
    if (!audioPlayer.duration) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * audioPlayer.duration;

    audioPlayer.currentTime = newTime;
}

// Format file size (bytes to MB)
function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(0) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Format time (seconds to hh:mm:ss or mm:ss)
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

// Show home page
function showHomePage() {
    homePage.classList.add('active');
    playerPage.classList.remove('active');
    playerControls.style.display = 'none';
    document.body.classList.remove('player-active');

    // Don't stop progress tracking - keep it running if audio is playing
    // stopProgressTracking();

    // Save current progress without pausing
    if (currentTracks[currentTrackIndex]) {
        const track = currentTracks[currentTrackIndex];
        
        // Add listening time from current session if playing
        if (isPlaying) {
            addListeningTime(track.name);
        }

        // Save current progress
        if (audioPlayer.duration) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;
            const timeToSave = (duration - currentTime < 30) ? 0 : currentTime;

            const existingData = getTrackProgress(track.name) || {};
            const progressData = {
                duration: duration,
                currentTime: timeToSave,
                lastPlayed: existingData.lastPlayed || Date.now(),
                firstListened: existingData.firstListened,
                totalListeningTime: existingData.totalListeningTime || 0
            };
            saveTrackProgress(track.name, progressData);
        }

        // Keep audio playing - don't pause
    }

    // Refresh playlist to show updated progress
    if (currentTracks.length > 0) {
        displayPlaylist();
    }
}

// Show player page
function showPlayerPage() {
    homePage.classList.remove('active');
    playerPage.classList.add('active');
    playerControls.style.display = 'block';
    document.body.classList.add('player-active');
}

// Setup Media Session API for background playback
function setupMediaSession(track) {
    if ('mediaSession' in navigator) {
        // Set metadata
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.name,
            artist: 'Unknown Artist',
            album: 'Local Files',
            artwork: [
                { src: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEyIiBoZWlnaHQ9IjUxMiIgdmlld0JveD0iMCAwIDUxMiA1MTIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiBmaWxsPSIjMzMzIi8+Cjx0ZXh0IHg9IjI1NiIgeT0iMjU2IiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iNDAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+4pmqPC90ZXh0Pgo8L3N2Zz4K', sizes: '512x512', type: 'image/svg+xml' }
            ]
        });

        // Set action handlers
        navigator.mediaSession.setActionHandler('play', () => {
            audioPlayer.play();
            isPlaying = true;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('pause', () => {
            audioPlayer.pause();
            isPlaying = false;
            updatePlayPauseButton();
        });

        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skipTime = details.seekOffset || 7;
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - skipTime);
        });

        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skipTime = details.seekOffset || 7;
            audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + skipTime);
        });

        navigator.mediaSession.setActionHandler('previoustrack', () => {
            rewind45();
        });

        navigator.mediaSession.setActionHandler('nexttrack', () => {
            forward45();
        });

        // Update playback state
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
}

// Update Media Session playback state
function updateMediaSessionState() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

        // Update position state for better scrubbing support
        if (audioPlayer.duration) {
            navigator.mediaSession.setPositionState({
                duration: audioPlayer.duration,
                playbackRate: audioPlayer.playbackRate,
                position: audioPlayer.currentTime
            });
        }
    }
}

// Handle mobile-specific behaviors
document.addEventListener('visibilitychange', function () {
    // Don't pause when tab becomes hidden - let Media Session API handle it
    // This allows background playback on mobile
    console.log('Visibility changed:', document.hidden ? 'hidden' : 'visible');
});

// Prevent zoom on double tap for better mobile experience
let lastTouchEnd = 0;
document.addEventListener('touchend', function (event) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

// Size→Duration mapping: records known size/duration pairs and interpolates for unknowns
const SIZE_DURATION_MAP_KEY = 'sizeDurationMap';
const SIZE_DURATION_MAP_MAX = 200;

function recordSizeDuration(size, duration) {
    if (!size || !duration || isNaN(duration)) return;
    try {
        const map = JSON.parse(localStorage.getItem(SIZE_DURATION_MAP_KEY) || '[]');
        // Update existing entry for this size, or push a new one
        const existing = map.findIndex(e => e.size === size);
        if (existing !== -1) {
            map[existing].duration = duration;
        } else {
            map.push({ size, duration });
            // If over cap, drop the entry whose size is most over-represented (oldest insertion order)
            if (map.length > SIZE_DURATION_MAP_MAX) {
                map.shift();
            }
        }
        localStorage.setItem(SIZE_DURATION_MAP_KEY, JSON.stringify(map));
    } catch (e) {
        console.error('Error saving size/duration map:', e);
    }
}

function estimateDuration(size) {
    if (!size) return null;
    try {
        const map = JSON.parse(localStorage.getItem(SIZE_DURATION_MAP_KEY) || '[]');
        if (map.length === 0) return null;

        // Sort by size ascending
        const sorted = [...map].sort((a, b) => a.size - b.size);

        // Exact match
        const exact = sorted.find(e => e.size === size);
        if (exact) return exact.duration;

        // Find bracketing entries
        let lo = null, hi = null;
        for (const e of sorted) {
            if (e.size <= size) lo = e;
            else if (hi === null) hi = e;
        }

        if (lo && hi) {
            // Linear interpolation
            const t = (size - lo.size) / (hi.size - lo.size);
            return lo.duration + t * (hi.duration - lo.duration);
        }

        // Extrapolate: use the ratio of the two nearest points
        if (lo === null) {
            // size is below all known points — scale from the smallest two
            if (sorted.length >= 2) {
                const ratio = sorted[0].duration / sorted[0].size;
                return size * ratio;
            }
            return sorted[0].duration * (size / sorted[0].size);
        }
        // size is above all known points — scale from the largest two
        if (sorted.length >= 2) {
            const top = sorted[sorted.length - 1];
            const ratio = top.duration / top.size;
            return size * ratio;
        }
        return sorted[sorted.length - 1].duration * (size / sorted[sorted.length - 1].size);
    } catch (e) {
        console.error('Error estimating duration:', e);
        return null;
    }
}

// Local Storage Functions for Progress Tracking
function getTrackProgress(fileName) {
    try {
        const stored = localStorage.getItem(fileName);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.error('Error reading progress from localStorage:', e);
        return null;
    }
}

function saveTrackProgress(fileName, progressData) {
    try {
        localStorage.setItem(fileName, JSON.stringify(progressData));
    } catch (e) {
        console.error('Error saving progress to localStorage:', e);
    }
}

function startProgressTracking(fileName) {
    // Clear any existing interval
    stopProgressTracking();

    // Update progress every 30 seconds
    progressUpdateInterval = setInterval(() => {
        if (audioPlayer && audioPlayer.duration && !isNaN(audioPlayer.currentTime)) {
            const currentTime = audioPlayer.currentTime;
            const duration = audioPlayer.duration;

            // Reset current time to 0 if within 1 minute of the end
            const timeToSave = (duration - currentTime < 60) ? 0 : currentTime;

            const existingData = getTrackProgress(fileName) || {};
            const progressData = {
                duration: duration,
                currentTime: timeToSave,
                lastPlayed: existingData.lastPlayed || Date.now(),
                firstListened: existingData.firstListened,
                totalListeningTime: existingData.totalListeningTime || 0
            };

            saveTrackProgress(fileName, progressData);
        }
    }, 30000); // 30 seconds
}

function stopProgressTracking() {
    if (progressUpdateInterval) {
        clearInterval(progressUpdateInterval);
        progressUpdateInterval = null;
    }
}

function updateLastPlayedDate(fileName) {
    const existingData = getTrackProgress(fileName) || {};
    const now = Date.now();

    existingData.lastPlayed = now;

    // Set first listened date if not already set
    if (!existingData.firstListened) {
        existingData.firstListened = now;
    }

    // Initialize total listening time if not set
    if (!existingData.totalListeningTime) {
        existingData.totalListeningTime = 0;
    }

    saveTrackProgress(fileName, existingData);
}

function addListeningTime(fileName) {
    if (!listeningSessionStart) return;

    const sessionDuration = (Date.now() - listeningSessionStart) / 1000; // Convert to seconds
    const existingData = getTrackProgress(fileName) || {};

    existingData.totalListeningTime = (existingData.totalListeningTime || 0) + sessionDuration;
    saveTrackProgress(fileName, existingData);

    // Reset session start
    listeningSessionStart = Date.now();
}

function getTrackStatsText(progressData) {
    if (!progressData || !progressData.firstListened) {
        return '';
    }

    const timeSinceFirst = getTimeSinceFirst(progressData.firstListened);
    const totalHours = formatTotalListeningTime(progressData.totalListeningTime || 0);

    return `First: ${timeSinceFirst} • Total: ${totalHours}`;
}

function getTimeSinceFirst(firstListenedTimestamp) {
    const now = Date.now();
    const diffMs = now - firstListenedTimestamp;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) {
        return 'today';
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks}w ago`;
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        return `${months}mo ago`;
    } else {
        const years = Math.floor(diffDays / 365);
        return `${years}y ago`;
    }
}

function formatTotalListeningTime(totalSeconds) {
    const hours = totalSeconds / 3600;

    if (hours < 1) {
        const minutes = Math.floor(totalSeconds / 60);
        return `${minutes}m`;
    } else if (hours < 10) {
        return `${hours.toFixed(1)}h`;
    } else {
        return `${Math.floor(hours)}h`;
    }
}

// Hide the currently playing track and move to the shortest non-hidden track
function hideCurrentAndPlayNext() {
    const track = currentTracks[currentTrackIndex];
    if (!track) return;

    // Stop current playback
    audioPlayer.pause();
    isPlaying = false;
    updatePlayPauseButton();

    // Save progress
    if (audioPlayer.duration) {
        addListeningTime(track.name);
        const existingData = getTrackProgress(track.name) || {};
        saveTrackProgress(track.name, {
            duration: audioPlayer.duration,
            currentTime: audioPlayer.currentTime,
            lastPlayed: existingData.lastPlayed || Date.now(),
            firstListened: existingData.firstListened,
            totalListeningTime: existingData.totalListeningTime || 0
        });
    }

    // Hide the track
    const hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');
    if (!hiddenTracks.includes(track.name)) {
        hiddenTracks.push(track.name);
        localStorage.setItem('hiddenTracks', JSON.stringify(hiddenTracks));
    }

    // Play shortest remaining track, or go back to playlist if none
    const nextIndex = getShortestVisibleTrackIndex();
    if (nextIndex !== -1) {
        playTrack(nextIndex);
    } else {
        showHomePage();
    }
}

function hideTrack(event, fileName) {
    if (event) {
        event.stopPropagation();
    }
    const hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');
    if (!hiddenTracks.includes(fileName)) {
        hiddenTracks.push(fileName);
        localStorage.setItem('hiddenTracks', JSON.stringify(hiddenTracks));
    }
    displayPlaylist();
}

function unhideTrack(event, fileName) {
    if (event) {
        event.stopPropagation();
    }
    let hiddenTracks = JSON.parse(localStorage.getItem('hiddenTracks') || '[]');
    hiddenTracks = hiddenTracks.filter(name => name !== fileName);
    localStorage.setItem('hiddenTracks', JSON.stringify(hiddenTracks));
    displayPlaylist();
}

// Preload durations for all tracks that don't have one saved yet
function preloadTrackDurations() {
    const tracksNeedingDuration = currentTracks.filter(track => {
        const data = getTrackProgress(track.name);
        return !data || !data.duration;
    });

    if (tracksNeedingDuration.length === 0) return;

    let index = 0;

    function loadNext() {
        if (index >= tracksNeedingDuration.length) return;
        const track = tracksNeedingDuration[index++];

        const tempAudio = new Audio();
        tempAudio.preload = 'metadata';
        tempAudio.src = track.url;
        tempAudio.load();

        tempAudio.addEventListener('loadedmetadata', function () {
            if (tempAudio.duration && !isNaN(tempAudio.duration)) {
                const existing = getTrackProgress(track.name) || {};
                if (!existing.duration) {
                    existing.duration = tempAudio.duration;
                    saveTrackProgress(track.name, existing);
                }
                // Record size→duration mapping for interpolation
                recordSizeDuration(track.size, tempAudio.duration);
            }
            tempAudio.src = '';
            loadNext();
            // Refresh playlist after each track loads so sorting improves progressively,
            // and always refresh on the last one.
            displayPlaylist();
        });

        tempAudio.addEventListener('error', function () {
            tempAudio.src = '';
            loadNext();
            // Still refresh on error so the final state is shown
            if (index === tracksNeedingDuration.length) {
                displayPlaylist();
            }
        });
    }

    loadNext();
}

function cycleSortMode() {
    currentSortIndex = (currentSortIndex + 1) % SORT_MODES.length;
    localStorage.setItem('sortIndex', currentSortIndex);
    const btn = document.getElementById('sort-btn');
    if (btn) btn.textContent = SORT_MODES[currentSortIndex].label;
    displayPlaylist();
}

function toggleHiddenView() {
    showingHiddenView = !showingHiddenView;
    const btn = document.getElementById('toggle-view-btn');
    if (showingHiddenView) {
        btn.innerHTML = '🎵 Show Regular Playlist';
        btn.style.background = 'rgba(74, 222, 128, 0.2)';
    } else {
        btn.innerHTML = '🗑️ Show Hidden Tracks';
        btn.style.background = '';
    }
    displayPlaylist();
}
