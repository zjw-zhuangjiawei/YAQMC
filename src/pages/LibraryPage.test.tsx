import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAccountRuntimeForTest, useAccountStore } from '../application/account-runtime';
import { initialPlayerState, usePlayerStore } from '../application/player-store';
import { ProviderContext } from '../application/provider-context';
import type {
  AccountPlaylistSummary,
  AccountSnapshot,
  CreatePlaylistRequest,
  PlaylistMutationResult,
  RemotePlayHistoryItem,
} from '../domain/music';
import i18n from '../i18n';
import { allSongs, playlists } from '../providers/fake/fixtures';
import { QQMusicProvider } from '../providers/qqmusic/qq-music-provider';
import { LibraryPage } from './LibraryPage';

const capabilities = {
  qrLogin: true,
  favoriteRead: true,
  favoriteWrite: true,
  playlistRead: true,
  playlistWrite: true,
  recentHistoryRead: true,
};

function guestSnapshot(): AccountSnapshot {
  return {
    state: 'guest',
    profileId: 'default',
    profile: null,
    entitlement: null,
    revision: 1,
    capabilities,
  };
}

function authenticatedSnapshot(avatarUrl: string | null = null): AccountSnapshot {
  return {
    state: 'authenticated',
    profileId: 'default',
    profile: {
      avatarUrl,
      nickname: 'Synthetic Listener',
      maskedIdentity: '10******01',
    },
    entitlement: {
      tier: 'green-diamond',
      membership: 'active',
      expiresAtMs: 1_800_000_000_000,
      permittedQualities: ['standard'],
      observedMaximumQuality: 'standard',
      restrictions: [],
    },
    revision: 3,
    capabilities,
  };
}

function playlistSummary(): AccountPlaylistSummary {
  const fixture = playlists[0]!;
  return {
    providerId: 'qqmusic',
    id: 'account-playlist-a',
    profileId: 'default',
    reference: { kind: 'owned', tid: 'account-playlist-a', dirId: 3001 },
    title: 'Synthetic Mix',
    description: fixture.description,
    owner: { id: 'account-owner', displayName: 'Synthetic Listener' },
    artwork: fixture.artwork,
    ownership: 'owned',
    capabilities: {
      canAddTracks: true,
      canRemoveTracks: true,
      canRename: true,
      canDelete: true,
      canReorder: false,
    },
    trackCount: 2,
    updatedAtMs: null,
  };
}

function renderLibrary(overrides: Partial<ComponentProps<typeof LibraryPage>> = {}) {
  const props: ComponentProps<typeof LibraryPage> = {
    view: 'favorites',
    snapshot: authenticatedSnapshot(),
    favorites: { status: 'idle' },
    playlists: { status: 'idle' },
    recent: { status: 'idle' },
    onNavigate: vi.fn(),
    onSignIn: vi.fn(),
    onRetry: vi.fn(),
    onLoadMore: vi.fn(),
    ...overrides,
  };
  return { ...render(<LibraryPage {...props} />), props };
}

function readyPlaylists(data: AccountPlaylistSummary[] = []) {
  return {
    status: 'ready' as const,
    data,
    nextCursor: null,
    total: data.length,
    fetchedAtMs: 1_800_000_000_000,
    authRevision: 3,
  };
}

function authenticatePlaylistWrites() {
  useAccountStore.setState({ snapshot: authenticatedSnapshot() });
}

describe('LibraryPage account resources', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
    resetAccountRuntimeForTest();
    usePlayerStore.setState(initialPlayerState);
  });

  it('shows a restrained sign-in state for a guest rather than a catalog error', () => {
    renderLibrary({ snapshot: guestSnapshot() });

    expect(screen.getByRole('heading', { name: 'Sign in to view Favorite Songs' })).toBeVisible();
    expect(screen.queryByText('Music is unavailable')).not.toBeInTheDocument();
  });

  it('labels remote QQ Music history without claiming local playback history', () => {
    const item: RemotePlayHistoryItem = {
      song: allSongs[0]!,
      playedAtMs: 1_800_000_000_000,
      source: 'qqmusic-account',
    };
    renderLibrary({
      view: 'recent',
      recent: {
        status: 'ready',
        data: [item],
        nextCursor: null,
        total: 1,
        fetchedAtMs: 1_800_000_000_000,
        authRevision: 3,
      },
    });

    expect(screen.getByText('QQ Music and local playback history')).toBeVisible();
    expect(screen.queryByText('Local playback history')).not.toBeInTheDocument();
  });

  it('keeps stale favorites visible with an explicit retry', () => {
    const onRetry = vi.fn();
    renderLibrary({
      favorites: {
        status: 'stale',
        data: [allSongs[0]!],
        total: 1,
        fetchedAtMs: 1_800_000_000_000,
        authRevision: 3,
      },
      onRetry,
    });

    expect(screen.getByText('Showing saved account data')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('favorites');
    expect(screen.getByText(allSongs[0]!.title)).toBeVisible();
  });

  it('renders empty, error, and reauthentication states with actionable controls', () => {
    const onRetry = vi.fn();
    const onSignIn = vi.fn();
    const view = renderLibrary({ favorites: { status: 'empty' }, onRetry, onSignIn });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('favorites');

    view.rerender(
      <LibraryPage
        {...view.props}
        favorites={{ status: 'error', error: 'network', data: null, nextCursor: null }}
      />,
    );
    expect(screen.getByText('QQ Music could not be reached.')).toBeVisible();

    view.rerender(
      <LibraryPage
        {...view.props}
        snapshot={{
          state: 'reauthentication-required',
          profileId: 'default',
          profile: authenticatedSnapshot().profile,
          entitlement: authenticatedSnapshot().entitlement,
          revision: 4,
          capabilities,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Authorize again' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('navigates playlist summaries through the distinct account route and paginates', () => {
    const summary = playlistSummary();
    const onNavigate = vi.fn();
    const onLoadMore = vi.fn();
    renderLibrary({
      view: 'playlists',
      playlists: {
        status: 'ready',
        data: [summary],
        nextCursor: 'next-page',
        total: 2,
        fetchedAtMs: 1_800_000_000_000,
        authRevision: 3,
      },
      onNavigate,
      onLoadMore,
    });

    fireEvent.click(screen.getByRole('button', { name: /Synthetic Mix/ }));
    expect(onNavigate).toHaveBeenCalledWith({ page: 'account-playlist', playlist: summary });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(onLoadMore).toHaveBeenCalledWith('playlists');
  });

  it('labels the structural Favorite Songs collection separately from saved playlists', () => {
    const favoriteCollection: AccountPlaylistSummary = {
      ...playlistSummary(),
      id: 'qqmusic:account-collection:favorites',
      reference: { kind: 'favorite-songs', dirId: 201 },
      title: 'Liked Tracks',
      ownership: 'favorite',
      capabilities: {
        canAddTracks: false,
        canRemoveTracks: false,
        canRename: false,
        canDelete: false,
        canReorder: false,
      },
    };
    renderLibrary({
      view: 'playlists',
      playlists: {
        status: 'ready',
        data: [favoriteCollection],
        nextCursor: null,
        total: 1,
        fetchedAtMs: 1_800_000_000_000,
        authRevision: 3,
      },
    });

    expect(screen.getByText('Favorite Songs')).toBeVisible();
    expect(screen.queryByText('Saved playlist')).not.toBeInTheDocument();
  });

  it('creates one playlist with the trimmed title and closes the form', async () => {
    const summary = { ...playlistSummary(), title: 'Roadtrip' };
    const createPlaylist = vi.fn(
      async (request: CreatePlaylistRequest): Promise<PlaylistMutationResult> => ({
        clientOperationId: request.clientOperationId,
        status: 'applied',
        playlist: summary,
        errorCode: null,
        authRevision: 3,
      }),
    );
    const provider = Object.assign(new QQMusicProvider(), { createPlaylist });
    authenticatePlaylistWrites();

    render(
      <ProviderContext.Provider value={provider}>
        <LibraryPage
          view="playlists"
          snapshot={authenticatedSnapshot()}
          favorites={{ status: 'idle' }}
          playlists={readyPlaylists()}
          recent={{ status: 'idle' }}
          onNavigate={vi.fn()}
          onSignIn={vi.fn()}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </ProviderContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New playlist' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Playlist name' }), {
      target: { value: '  Roadtrip  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create playlist' }));

    await waitFor(() => expect(createPlaylist).toHaveBeenCalledOnce());
    expect(createPlaylist.mock.calls[0]![0]).toMatchObject({ title: 'Roadtrip' });
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Playlist name' })).not.toBeInTheDocument(),
    );
  });

  it('hides the new-playlist control when the account cannot write playlists', () => {
    renderLibrary({
      view: 'playlists',
      snapshot: {
        ...authenticatedSnapshot(),
        capabilities: { ...capabilities, playlistWrite: false },
      },
      playlists: readyPlaylists(),
    });

    expect(screen.queryByRole('button', { name: 'New playlist' })).not.toBeInTheDocument();
  });
});
