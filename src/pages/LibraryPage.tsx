import { Play, Plus } from 'lucide-react';
import { useContext, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CREATE_PLAYLIST_KEY,
  useAccountStore,
  usePlaylistMutationState,
  type AccountListResource,
  type LibraryResource,
} from '../application/account-runtime';
import type { AppRoute } from '../application/navigation';
import { usePlayerStore } from '../application/player-store';
import { ProviderContext } from '../application/provider-context';
import { isAccountMusicProvider } from '../providers/music-provider';
import type {
  AccountPlaylistSummary,
  AccountSnapshot,
  RemotePlayHistoryItem,
  Song,
} from '../domain/music';
import { TrackList } from '../components/TrackList';
import { Artwork } from '../components/ui/Artwork';

export type AccountLibraryView = AccountListResource;

interface LibraryPageProps {
  view: AccountLibraryView;
  snapshot: AccountSnapshot;
  favorites: LibraryResource<Song[]>;
  playlists: LibraryResource<AccountPlaylistSummary[]>;
  recent: LibraryResource<RemotePlayHistoryItem[]>;
  onNavigate: (route: AppRoute) => void;
  onSignIn: () => void;
  onRetry: (resource: AccountListResource) => void;
  onLoadMore: (resource: AccountListResource) => void;
}

function resourceData<T>(resource: LibraryResource<T>): T | null {
  if (resource.status === 'ready' || resource.status === 'stale') return resource.data;
  if (resource.status === 'loading' || resource.status === 'error') return resource.data;
  return null;
}

function canLoadMore<T>(resource: LibraryResource<T>): boolean {
  return resource.status === 'ready' && resource.nextCursor !== null;
}

export function LibraryPage({
  view,
  snapshot,
  favorites,
  playlists,
  recent,
  onNavigate,
  onSignIn,
  onRetry,
  onLoadMore,
}: LibraryPageProps) {
  const { t } = useTranslation('pages', { keyPrefix: 'library' });
  const { t: common } = useTranslation('common');
  const { t: playlistT } = useTranslation('pages', { keyPrefix: 'playlist' });
  const playTracks = usePlayerStore((state) => state.playTracks);
  const provider = useContext(ProviderContext);
  const accountProvider = provider && isAccountMusicProvider(provider) ? provider : null;
  const createPlaylist = useAccountStore((state) => state.createPlaylist);
  const { pending: createPending, notice: createNotice } =
    usePlaylistMutationState(CREATE_PLAYLIST_KEY);
  const [creating, setCreating] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const normalizedTitle = titleDraft.trim();
  const titleValid =
    normalizedTitle.length > 0 &&
    Array.from(normalizedTitle).length <= 80 &&
    !/[\p{Cc}\p{Cf}]/u.test(normalizedTitle);
  const canCreate = accountProvider !== null && snapshot.capabilities.playlistWrite;

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!accountProvider || createPending || !titleValid) return;
    const result = await createPlaylist(accountProvider, normalizedTitle);
    if (result?.status === 'applied' || result?.status === 'reconciled') setCreating(false);
  };
  const title = t(
    view === 'favorites'
      ? 'favoriteSongs'
      : view === 'playlists'
        ? 'myPlaylists'
        : 'recentlyPlayed',
  );

  if (snapshot.state !== 'authenticated') {
    const reauthentication =
      snapshot.state === 'session-expired' || snapshot.state === 'reauthentication-required';
    const pending =
      snapshot.state === 'restoring-session' ||
      snapshot.state === 'starting-login' ||
      snapshot.state === 'waiting-for-scan' ||
      snapshot.state === 'waiting-for-confirmation';
    return (
      <div className="page standard-page library-page">
        <header className="page-heading">
          <p className="eyebrow">{t('eyebrow')}</p>
          <h1>{pending ? t('checkingAccount') : t('signInHeading', { title })}</h1>
        </header>
        <div className="account-library-state">
          <p>
            {pending
              ? t('checkingAccountBody')
              : reauthentication
                ? t('reauthBody')
                : t('signInBody')}
          </p>
          {!pending && (
            <button type="button" className="button button--primary" onClick={onSignIn}>
              {reauthentication ? t('reauthenticate') : t('signIn')}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderResource<T>(
    resourceName: AccountListResource,
    resource: LibraryResource<T>,
    renderContent: (data: T) => ReactNode,
  ): ReactNode {
    const data = resourceData(resource);
    const initialLoading = resource.status === 'idle' || (resource.status === 'loading' && !data);
    const initialError = resource.status === 'error' && !data;

    if (initialLoading) {
      return (
        <div className="account-library-state" aria-live="polite">
          <p>{t('loading', { title })}</p>
        </div>
      );
    }
    if (resource.status === 'account-required') {
      return (
        <div className="account-library-state">
          <p>{t('signInBody')}</p>
          <button type="button" className="button button--primary" onClick={onSignIn}>
            {t('signIn')}
          </button>
        </div>
      );
    }
    if (resource.status === 'reauthentication-required') {
      return (
        <div className="account-library-state">
          <p>{t('reauthBody')}</p>
          <button type="button" className="button button--primary" onClick={onSignIn}>
            {t('reauthenticate')}
          </button>
        </div>
      );
    }
    if (initialError && resource.status === 'error') {
      return (
        <div className="account-library-state account-library-state--error">
          <p>{t(`errors.${resource.error}`)}</p>
          <button type="button" onClick={() => onRetry(resourceName)}>
            {common('retry')}
          </button>
        </div>
      );
    }
    if (resource.status === 'empty') {
      return (
        <div className="account-library-state">
          <p>{t('empty', { title })}</p>
          <button type="button" onClick={() => onRetry(resourceName)}>
            {common('retry')}
          </button>
        </div>
      );
    }
    if (!data) return null;

    return (
      <>
        {resource.status === 'stale' && (
          <div className="account-library-notice" role="status">
            <span>{t('stale')}</span>
            <button type="button" onClick={() => onRetry(resourceName)}>
              {common('retry')}
            </button>
          </div>
        )}
        {resource.status === 'error' && (
          <div className="account-library-notice account-library-notice--error" role="status">
            <span>{t(`errors.${resource.error}`)}</span>
            <button type="button" onClick={() => onRetry(resourceName)}>
              {common('retry')}
            </button>
          </div>
        )}
        {resource.status === 'loading' && (
          <div className="account-library-notice" role="status">
            {t('loadingMore')}
          </div>
        )}

        {renderContent(data)}

        {(canLoadMore(resource) || resource.status === 'loading') && (
          <div className="account-library-pagination">
            <button
              type="button"
              disabled={resource.status === 'loading'}
              onClick={() => onLoadMore(resourceName)}
            >
              {resource.status === 'loading' ? t('loadingMore') : t('loadMore')}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page standard-page library-page" data-library-view={view}>
      <header className="page-heading">
        <p className="eyebrow">{t('eyebrow')}</p>
        <h1>{title}</h1>
      </header>

      {view === 'favorites'
        ? renderResource('favorites', favorites, (songs) => (
            <section className="content-section content-section--last">
              <div className="section-heading">
                <h2>{t('favoriteSongs')}</h2>
                <button type="button" onClick={() => playTracks(songs)}>
                  <Play size={15} fill="currentColor" /> {t('playAll')}
                </button>
              </div>
              <TrackList tracks={songs} showAlbum compact />
            </section>
          ))
        : view === 'recent'
          ? renderResource('recent', recent, (items) => (
              <section className="content-section content-section--last">
                <div className="section-heading">
                  <div>
                    <h2>{t('recentlyPlayed')}</h2>
                    <p>{t('remoteHistoryLabel')}</p>
                  </div>
                </div>
                <TrackList tracks={items.map((item) => item.song)} showAlbum compact />
              </section>
            ))
          : renderResource('playlists', playlists, (items) => (
              <section className="content-section content-section--last">
                <div className="section-heading">
                  <h2>{t('myPlaylists')}</h2>
                  {canCreate && !creating && (
                    <button
                      type="button"
                      disabled={createPending}
                      onClick={() => setCreating(true)}
                    >
                      <Plus size={15} /> {t('newPlaylist')}
                    </button>
                  )}
                </div>
                {creating && (
                  <form
                    className="account-playlist-mutation-form"
                    onSubmit={(event) => void submitCreate(event)}
                  >
                    <label htmlFor="library-new-playlist-name">{t('playlistName')}</label>
                    <div>
                      <input
                        id="library-new-playlist-name"
                        value={titleDraft}
                        disabled={createPending}
                        maxLength={80}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                      <button type="submit" disabled={createPending || !titleValid}>
                        {t('createPlaylist')}
                      </button>
                      <button
                        type="button"
                        disabled={createPending}
                        onClick={() => setCreating(false)}
                      >
                        {common('cancel')}
                      </button>
                    </div>
                  </form>
                )}
                {createNotice && (
                  <p className="account-playlist-mutation-notice" role="status">
                    {playlistT(`mutation.${createNotice.operation}.${createNotice.outcome}`)}
                  </p>
                )}
                <div className="account-playlist-grid">
                  {items.map((playlist) => (
                    <button
                      type="button"
                      className="account-playlist-card"
                      key={playlist.id}
                      onClick={() => onNavigate({ page: 'account-playlist', playlist })}
                    >
                      <Artwork artwork={playlist.artwork} />
                      <span className="account-playlist-card__copy">
                        <strong>{playlist.title}</strong>
                        <small>
                          {playlist.owner.displayName} ·{' '}
                          {common('songCount', { count: playlist.trackCount })}
                        </small>
                        <small>
                          {playlist.ownership === 'owned'
                            ? t('ownedPlaylist')
                            : playlist.ownership === 'favorite'
                              ? t('favoriteCollection')
                              : playlist.ownership === 'system'
                                ? t('systemCollection')
                                : t('savedPlaylist')}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
    </div>
  );
}
