import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../features/ai/controllers/agent_controller.dart';
import '../features/ai/controllers/settings_controller.dart';
import '../features/ai/data/ai_allow_list_repository.dart';
import '../features/ai/data/ai_settings_store.dart';
import '../features/notes/controllers/note_editor_controller.dart';
import '../features/notes/controllers/notes_controller.dart';
import '../features/notes/data/in_memory_notes_repository.dart';
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
  late final NotesRepository _notesRepository;
  late final NotesController _notesController;
  late final AiSettingsStore _aiSettingsStore;

  SettingsController? _settingsController;
  AgentController? _agentController;

  @override
  void initState() {
    super.initState();
    _appearanceController = AppearanceController();
    _notesRepository = InMemoryNotesRepository.seeded();
    _notesController = NotesController(_notesRepository);
    _aiSettingsStore = SecureAiSettingsStore();
    _loadAiConfiguration();
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
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _appearanceController,
        builder: (context, _) => MaterialApp(
          title: 'anotAI',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: _appearanceController.themeMode,
          home: NoteListPage(
            controller: _notesController,
            createEditorController: (note) => NoteEditorController(
              note: note,
              repository: _notesRepository,
              agentController: _agentController,
            ),
            onOpenSettings: (context) {
              final settingsController = _settingsController;
              if (settingsController == null) return;
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => SettingsPage(
                    controller: _appearanceController,
                    settingsController: settingsController,
                  ),
                ),
              );
            },
          ),
        ),
      );
}
