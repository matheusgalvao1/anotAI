import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../controllers/note_editor_controller.dart';
import '../controllers/notes_controller.dart';
import '../models/note.dart';
import 'note_editor_page.dart';

class NoteListPage extends StatefulWidget {
  const NoteListPage({
    required this.controller,
    required this.createEditorController,
    required this.onOpenSettings,
    super.key,
  });

  final NotesController controller;
  final NoteEditorController Function(Note note) createEditorController;
  final void Function(BuildContext context) onOpenSettings;

  @override
  State<NoteListPage> createState() => _NoteListPageState();
}

class _NoteListPageState extends State<NoteListPage> {
  @override
  void initState() {
    super.initState();
    widget.controller.load();
  }

  Future<void> _openNote(Note note) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => NoteEditorPage(
          controller: widget.createEditorController(note),
        ),
      ),
    );
    await widget.controller.load();
  }

  Future<void> _createNote() async {
    final note = await widget.controller.createNote();
    if (!mounted) return;
    await _openNote(note);
  }

  Future<void> _deleteNote(Note note) async {
    final deleted = await widget.controller.deleteNote(note.id);
    if (!mounted || deleted == null) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('Deleted “${deleted.title}”'),
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () => widget.controller.restoreNote(deleted),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          toolbarHeight: 72,
          title: Text(
            'Notes',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.8,
                ),
          ),
          actions: [
            IconButton(
              tooltip: 'Settings',
              onPressed: () => widget.onOpenSettings(context),
              icon: const Icon(CupertinoIcons.gear_alt, size: 25),
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: AnimatedBuilder(
          animation: widget.controller,
          builder: (context, _) {
            if (widget.controller.isLoading &&
                widget.controller.notes.isEmpty) {
              return const Center(child: CircularProgressIndicator.adaptive());
            }
            if (widget.controller.error != null) {
              return _ErrorState(onRetry: widget.controller.load);
            }
            if (widget.controller.notes.isEmpty) {
              return const _EmptyState();
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 112),
              itemCount: widget.controller.notes.length,
              separatorBuilder: (_, __) => const Divider(indent: 64),
              itemBuilder: (context, index) {
                final note = widget.controller.notes[index];
                return Dismissible(
                  key: ValueKey(note.id),
                  direction: DismissDirection.endToStart,
                  onDismissed: (_) => _deleteNote(note),
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 24),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.error,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child:
                        const Icon(CupertinoIcons.delete, color: Colors.white),
                  ),
                  child: _NoteRow(note: note, onTap: () => _openNote(note)),
                );
              },
            );
          },
        ),
        floatingActionButton: FloatingActionButton.large(
          tooltip: 'New note',
          onPressed: _createNote,
          child: const Icon(CupertinoIcons.add, size: 30),
        ),
      );
}

class _NoteRow extends StatelessWidget {
  const _NoteRow({required this.note, required this.onTap});

  final Note note;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  CupertinoIcons.doc_text,
                  size: 20,
                  color: colors.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      note.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      [
                        _relativeTime(note.updatedAt),
                        if (note.preview.isNotEmpty) note.preview,
                      ].join('  ·  '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.bodyMedium
                          ?.copyWith(color: colors.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              Icon(CupertinoIcons.chevron_forward,
                  size: 17, color: colors.outline),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                CupertinoIcons.square_pencil,
                size: 52,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 18),
              Text('No notes yet',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              const Text('Tap + to start writing.',
                  textAlign: TextAlign.center),
            ],
          ),
        ),
      );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Notes could not be loaded.'),
            const SizedBox(height: 8),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      );
}

String _relativeTime(DateTime value) {
  final difference = DateTime.now().difference(value);
  if (difference.inMinutes < 1) return 'Now';
  if (difference.inHours < 1) return '${difference.inMinutes}m';
  if (difference.inDays < 1) return '${difference.inHours}h';
  if (difference.inDays < 7) return '${difference.inDays}d';
  return '${value.month}/${value.day}/${value.year}';
}
