import 'dart:async';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../core/theme/app_theme.dart';
import '../features/ai/controllers/agent_controller.dart';
import '../features/ai/controllers/settings_controller.dart';
import '../features/ai/data/ai_allow_list_repository.dart';
import '../features/ai/data/ai_settings_store.dart';
import '../features/notes/controllers/note_editor_controller.dart';
import '../features/notes/controllers/notes_controller.dart';
import '../features/notes/data/file_notes_repository.dart';
import '../features/notes/data/note_transfer.dart';
import '../features/notes/data/notes_repository.dart';
import '../features/notes/views/note_list_page.dart';
import '../features/settings/controllers/appearance_controller.dart';
import '../features/settings/views/settings_page.dart';

class AnotaiApp extends StatefulWidget {
  const AnotaiApp({super.key});

  @override
  State<AnotaiApp> createState() => _AnotaiAppState();
}

class _AnotaiAppState extends State<AnotaiApp> {
  late final AppearanceController _appearanceController;
  late final AiSettingsStore _aiSettingsStore;

  NotesRepository? _notesRepository;
  NotesController? _notesController;
  NoteTransfer? _noteTransfer;
  SettingsController? _settingsController;
  AgentController? _agentController;

  @override
  void initState() {
    super.initState();
    _appearanceController = AppearanceController();
    _aiSettingsStore = SecureAiSettingsStore();
    _initNotes();
    _loadAiConfiguration();
  }

  Future<void> _initNotes() async {
    final documents = await getApplicationDocumentsDirectory();
    final root = Directory('${documents.path}${Platform.pathSeparator}Notes');
    final repository = FileNotesRepository(root);
    final controller = NotesController(repository);
    final transfer = NoteTransfer(
      notesRepository: repository,
      pickMarkdownFiles: _pickMarkdownFiles,
      shareFiles: _shareFiles,
    );
    if (!mounted) return;
    setState(() {
      _notesRepository = repository;
      _notesController = controller;
      _noteTransfer = transfer;
    });
  }

  Future<List<String>> _pickMarkdownFiles() async {
    // iOS needs explicit uniform type identifiers (it throws when a type group
    // only carries extensions), while Android filters by extension. Only the
    // markdown UTI is allowed, so the picker offers .md files, not all text.
    const typeGroup = XTypeGroup(
      label: 'Markdown',
      extensions: ['md'],
      uniformTypeIdentifiers: ['net.daringfireball.markdown'],
    );
    final files = await openFiles(acceptedTypeGroups: const [typeGroup]);
    return files
        .map((file) => file.path)
        .where((path) => path.isNotEmpty)
        .toList();
  }

  Future<void> _shareFiles(List<String> paths, Rect? origin) async {
    await SharePlus.instance.share(
      ShareParams(
        files: paths.map((path) => XFile(path)).toList(growable: false),
        sharePositionOrigin: origin,
      ),
    );
  }

  Future<void> _loadAiConfiguration() async {
    final settingsController = SettingsController(
      allowListRepository: const AiAllowListRepository(),
      store: _aiSettingsStore,
    );
    await settingsController.load();
    if (!mounted) return;
    final allowList = settingsController.allowList;
    if (allowList == null) return;
    setState(() {
      _settingsController = settingsController;
      _agentController = AgentController(
        settings: _aiSettingsStore,
        allowList: allowList,
      );
    });
  }

  @override
  void dispose() {
    _appearanceController.dispose();
    _notesController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _appearanceController,
        builder: (context, _) {
          final notesController = _notesController;
          final notesRepository = _notesRepository;
          return MaterialApp(
            title: 'anotAI',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.light(),
            darkTheme: AppTheme.dark(),
            themeMode: _appearanceController.themeMode,
            home: (notesController == null || notesRepository == null)
                ? const _StartupSplash()
                : NoteListPage(
                    controller: notesController,
                    createEditorController: (note) => NoteEditorController(
                      note: note,
                      repository: notesRepository,
                      agentController: _agentController,
                    ),
                    onOpenSettings: (context) {
                      final settingsController = _settingsController;
                      final noteTransfer = _noteTransfer;
                      if (settingsController == null || noteTransfer == null) {
                        return;
                      }
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => SettingsPage(
                            controller: _appearanceController,
                            settingsController: settingsController,
                            noteTransfer: noteTransfer,
                            onNotesImported: () =>
                                unawaited(notesController.load()),
                          ),
                        ),
                      );
                    },
                  ),
          );
        },
      );
}

class _StartupSplash extends StatelessWidget {
  const _StartupSplash();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator.adaptive()),
      );
}
