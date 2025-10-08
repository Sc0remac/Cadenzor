"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

interface AdminUsersPanelProps {
  accessToken: string | null;
  currentUserId?: string | null;
  onChange?: () => void;
}

export interface AdminUser {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  company: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  isAdmin: boolean;
  updatedAt: string | null;
  createdAt: string | null;
}

interface UserFormState {
  email: string;
  fullName: string;
  role: string;
  company: string;
  phone: string;
  location: string;
  bio: string;
  isAdmin: boolean;
}

const EMPTY_FORM: UserFormState = {
  email: "",
  fullName: "",
  role: "",
  company: "",
  phone: "",
  location: "",
  bio: "",
  isAdmin: false,
};

export default function AdminUsersPanel({ accessToken, currentUserId, onChange }: AdminUsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [formState, setFormState] = useState<UserFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const canLoad = Boolean(accessToken);

  const fetchUsers = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (debouncedQuery) {
      params.set("q", debouncedQuery);
    }

    try {
      const response = await fetch(`/api/admin/users${params.toString() ? `?${params.toString()}` : ""}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load users");
      }

      setUsers(Array.isArray(payload?.users) ? (payload.users as AdminUser[]) : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, debouncedQuery]);

  useEffect(() => {
    if (!canLoad) {
      return;
    }

    void fetchUsers();
  }, [canLoad, fetchUsers, refreshToken]);

  const startEditing = useCallback(
    (user: AdminUser) => {
      setToggleError(null);
      setEditingUser(user);
      setFormState({
        email: user.email ?? "",
        fullName: user.fullName ?? "",
        role: user.role ?? "",
        company: user.company ?? "",
        phone: user.phone ?? "",
        location: user.location ?? "",
        bio: user.bio ?? "",
        isAdmin: user.isAdmin,
      });
    },
    []
  );

  const cancelEditing = useCallback(() => {
    setEditingUser(null);
    setFormState(EMPTY_FORM);
    setSaving(false);
    setToggleError(null);
  }, []);

  const handleFormChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleToggleAdmin = useCallback(
    async (user: AdminUser) => {
      if (!accessToken) {
        return;
      }

      setToggleError(null);

      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ isAdmin: !user.isAdmin }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update admin status");
        }

        setUsers((prev) =>
          prev.map((entry) => (entry.id === user.id ? { ...entry, isAdmin: !user.isAdmin } : entry))
        );
        setRefreshToken((token) => token + 1);
        onChange?.();
      } catch (err: any) {
        setToggleError(err?.message || "Failed to update admin status");
      }
    },
    [accessToken, onChange]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!accessToken || !editingUser) {
        return;
      }

      setSaving(true);
      setToggleError(null);

      try {
        const response = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: formState.email,
            fullName: formState.fullName,
            role: formState.role,
            company: formState.company,
            phone: formState.phone,
            location: formState.location,
            bio: formState.bio,
            isAdmin: formState.isAdmin,
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to update user");
        }

        const updated = payload?.user as AdminUser | undefined;

        if (updated) {
          setUsers((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
        }

        setRefreshToken((token) => token + 1);
        onChange?.();
        cancelEditing();
      } catch (err: any) {
        setToggleError(err?.message || "Failed to update user");
      } finally {
        setSaving(false);
      }
    },
    [accessToken, editingUser, formState, onChange, cancelEditing]
  );

  const selectedUserLabel = useMemo(() => {
    if (!editingUser) {
      return null;
    }

    return editingUser.fullName || editingUser.email || editingUser.id;
  }, [editingUser]);

  if (!accessToken) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        Provide a valid session token to manage users.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
            <p className="text-sm text-gray-600">
              Search, edit, and promote teammates. Use the admin toggle to grant elevated access.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {loading ? "Loading…" : `${users.length} result${users.length === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col">
            <label htmlFor="admin-user-search" className="text-xs font-semibold uppercase text-gray-500">
              Search
            </label>
            <input
              id="admin-user-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name, email, role, company"
              className="mt-1 w-64 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="ml-auto rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
          >
            Refresh
          </button>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">User</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Company</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Admin</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                const isCurrentUser = user.id === currentUserId;
                return (
                  <tr key={user.id} className={isCurrentUser ? "bg-gray-50" : undefined}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{user.fullName || user.email || user.id}</div>
                      <div className="text-xs text-gray-500">{user.email || "No email"}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{user.role || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{user.company || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          user.isAdmin
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {user.isAdmin ? "Admin" : "Standard"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {user.updatedAt ? new Date(user.updatedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggleAdmin(user)}
                          className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                        >
                          {user.isAdmin ? "Revoke" : "Promote"}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditing(user)}
                          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-gray-700"
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    No users found. Adjust filters or refresh the list.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="h-fit rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {editingUser ? (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Edit user</h3>
              <p className="text-xs text-gray-500">{selectedUserLabel}</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <label className="text-xs font-semibold uppercase text-gray-500">
                Email
                <input
                  name="email"
                  type="email"
                  value={formState.email}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Full name
                <input
                  name="fullName"
                  value={formState.fullName}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Role
                <input
                  name="role"
                  value={formState.role}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Company
                <input
                  name="company"
                  value={formState.company}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Phone
                <input
                  name="phone"
                  value={formState.phone}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Location
                <input
                  name="location"
                  value={formState.location}
                  onChange={handleFormChange}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase text-gray-500">
                Bio
                <textarea
                  name="bio"
                  value={formState.bio}
                  onChange={handleFormChange}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={formState.isAdmin}
                onChange={(event) => setFormState((prev) => ({ ...prev, isAdmin: event.target.checked }))}
              />
              Grant admin access
            </label>
            {toggleError ? <p className="text-sm text-red-600">{toggleError}</p> : null}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelEditing}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-400 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-500"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex h-full flex-col justify-center text-sm text-gray-600">
            <p>Select a user to view and edit details.</p>
            <p className="mt-2 text-xs text-gray-500">
              Use the Promote button to elevate a teammate. Changes take effect immediately.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
